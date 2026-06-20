package com.trackbase.app.plugins.audiorecorder;

import android.Manifest;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.RandomAccessFile;

/**
 * Native microphone capture using {@link AudioRecord} (raw PCM), bypassing the
 * Android WebView audio stack entirely. Captured PCM is accumulated on a
 * background thread and written to a standard 16-bit WAV file in the app cache
 * directory on stop.
 */
@CapacitorPlugin(
    name = "NativeAudioRecorder",
    permissions = {
        @Permission(alias = NativeAudioRecorderPlugin.MIC_ALIAS, strings = { Manifest.permission.RECORD_AUDIO })
    }
)
public class NativeAudioRecorderPlugin extends Plugin {

    static final String MIC_ALIAS = "microphone";

    private static final int CHANNEL_CONFIG = AudioFormat.CHANNEL_IN_MONO;
    private static final int AUDIO_FORMAT = AudioFormat.ENCODING_PCM_16BIT;
    private static final int BITS_PER_SAMPLE = 16;
    // Sample rates to try (in order) when the requested rate isn't supported.
    private static final int[] FALLBACK_RATES = { 44100, 22050, 16000, 11025, 8000 };

    private AudioRecord audioRecord;
    private Thread recordingThread;
    private volatile boolean isRecording = false;

    private ByteArrayOutputStream pcmBuffer;
    private int actualSampleRate;
    private int channelCount = 1;

    // ── Permissions ─────────────────────────────────────────────────────────

    @PluginMethod
    public void checkPermission(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", getPermissionState(MIC_ALIAS) == PermissionState.GRANTED);
        call.resolve(ret);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (getPermissionState(MIC_ALIAS) == PermissionState.GRANTED) {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            call.resolve(ret);
            return;
        }
        requestPermissionForAlias(MIC_ALIAS, call, "permissionCallback");
    }

    @PermissionCallback
    private void permissionCallback(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", getPermissionState(MIC_ALIAS) == PermissionState.GRANTED);
        call.resolve(ret);
    }

    // ── Recording ───────────────────────────────────────────────────────────

    @PluginMethod
    public void startRecording(PluginCall call) {
        if (isRecording) {
            call.reject("Already recording");
            return;
        }
        if (getPermissionState(MIC_ALIAS) != PermissionState.GRANTED) {
            call.reject("Microphone permission not granted");
            return;
        }

        int requestedRate = call.getInt("sampleRate", 44100);
        channelCount = 1; // CHANNEL_IN_MONO

        int sampleRate = resolveSampleRate(requestedRate);
        if (sampleRate <= 0) {
            call.reject("No supported sample rate found");
            return;
        }

        int minBuffer = AudioRecord.getMinBufferSize(sampleRate, CHANNEL_CONFIG, AUDIO_FORMAT);
        if (minBuffer == AudioRecord.ERROR || minBuffer == AudioRecord.ERROR_BAD_VALUE) {
            call.reject("Unable to determine buffer size for sample rate " + sampleRate);
            return;
        }
        final int bufferSize = minBuffer * 2;

        AudioRecord recorder;
        try {
            recorder = new AudioRecord(
                MediaRecorder.AudioSource.MIC,
                sampleRate,
                CHANNEL_CONFIG,
                AUDIO_FORMAT,
                bufferSize
            );
        } catch (IllegalArgumentException e) {
            call.reject("Failed to create AudioRecord: " + e.getMessage());
            return;
        }

        if (recorder.getState() != AudioRecord.STATE_INITIALIZED) {
            recorder.release();
            call.reject("AudioRecord failed to initialize");
            return;
        }

        audioRecord = recorder;
        actualSampleRate = sampleRate;
        pcmBuffer = new ByteArrayOutputStream();

        try {
            audioRecord.startRecording();
        } catch (IllegalStateException e) {
            releaseRecorder();
            call.reject("Failed to start recording: " + e.getMessage());
            return;
        }

        isRecording = true;

        recordingThread = new Thread(() -> readLoop(bufferSize), "NativeAudioRecorderThread");
        recordingThread.start();

        call.resolve();
    }

    private void readLoop(int bufferSize) {
        byte[] buffer = new byte[bufferSize];
        while (isRecording) {
            AudioRecord recorder = audioRecord;
            if (recorder == null) break;
            int read = recorder.read(buffer, 0, buffer.length);
            if (read > 0) {
                synchronized (this) {
                    if (pcmBuffer != null) pcmBuffer.write(buffer, 0, read);
                }
            } else if (read == AudioRecord.ERROR_INVALID_OPERATION || read == AudioRecord.ERROR_BAD_VALUE) {
                break;
            }
        }
    }

    @PluginMethod
    public void stopRecording(PluginCall call) {
        if (!isRecording && audioRecord == null) {
            call.reject("Not recording");
            return;
        }

        stopAndJoin();

        byte[] pcmData;
        synchronized (this) {
            pcmData = pcmBuffer != null ? pcmBuffer.toByteArray() : new byte[0];
            pcmBuffer = null;
        }
        releaseRecorder();

        File wavFile;
        try {
            wavFile = new File(getContext().getCacheDir(), "recording-" + System.currentTimeMillis() + ".wav");
            writeWavFile(wavFile, pcmData, actualSampleRate, channelCount);
        } catch (IOException e) {
            call.reject("Failed to write WAV file: " + e.getMessage());
            return;
        }

        int bytesPerSecond = actualSampleRate * channelCount * (BITS_PER_SAMPLE / 8);
        long durationMs = bytesPerSecond > 0 ? (long) pcmData.length * 1000L / bytesPerSecond : 0L;

        JSObject ret = new JSObject();
        ret.put("filePath", wavFile.getAbsolutePath());
        ret.put("durationMs", durationMs);
        ret.put("sampleRate", actualSampleRate);
        call.resolve(ret);
    }

    @PluginMethod
    public void cancelRecording(PluginCall call) {
        stopAndJoin();
        synchronized (this) {
            pcmBuffer = null;
        }
        releaseRecorder();
        call.resolve();
    }

    // ── File helpers ──────────────────────────────────────────────────────────

    @PluginMethod
    public void readAsBase64(PluginCall call) {
        String filePath = call.getString("filePath");
        if (filePath == null) {
            call.reject("filePath is required");
            return;
        }
        File file = new File(filePath);
        if (!file.exists()) {
            call.reject("File does not exist: " + filePath);
            return;
        }
        try (RandomAccessFile raf = new RandomAccessFile(file, "r")) {
            byte[] bytes = new byte[(int) raf.length()];
            raf.readFully(bytes);
            JSObject ret = new JSObject();
            ret.put("data", Base64.encodeToString(bytes, Base64.NO_WRAP));
            call.resolve(ret);
        } catch (IOException e) {
            call.reject("Failed to read file: " + e.getMessage());
        }
    }

    @PluginMethod
    public void deleteFile(PluginCall call) {
        String filePath = call.getString("filePath");
        if (filePath == null) {
            call.reject("filePath is required");
            return;
        }
        File file = new File(filePath);
        if (file.exists()) {
            // Best-effort delete; resolve regardless so cleanup never blocks the UI.
            //noinspection ResultOfMethodCallIgnored
            file.delete();
        }
        call.resolve();
    }

    // ── Internals ───────────────────────────────────────────────────────────

    private int resolveSampleRate(int requested) {
        if (isSampleRateSupported(requested)) return requested;
        for (int rate : FALLBACK_RATES) {
            if (rate != requested && isSampleRateSupported(rate)) return rate;
        }
        return -1;
    }

    private boolean isSampleRateSupported(int rate) {
        if (rate <= 0) return false;
        int min = AudioRecord.getMinBufferSize(rate, CHANNEL_CONFIG, AUDIO_FORMAT);
        return min != AudioRecord.ERROR && min != AudioRecord.ERROR_BAD_VALUE;
    }

    private void stopAndJoin() {
        isRecording = false;
        Thread thread = recordingThread;
        recordingThread = null;
        if (thread != null) {
            try {
                thread.join(1000);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
        AudioRecord recorder = audioRecord;
        if (recorder != null && recorder.getRecordingState() == AudioRecord.RECORDSTATE_RECORDING) {
            try {
                recorder.stop();
            } catch (IllegalStateException ignored) {
                // already stopped
            }
        }
    }

    private void releaseRecorder() {
        AudioRecord recorder = audioRecord;
        audioRecord = null;
        if (recorder != null) {
            try {
                recorder.release();
            } catch (Exception ignored) {
                // nothing to do
            }
        }
    }

    @Override
    protected void handleOnDestroy() {
        super.handleOnDestroy();
        stopAndJoin();
        synchronized (this) {
            pcmBuffer = null;
        }
        releaseRecorder();
    }

    /** Write a standard 44-byte WAV header followed by the PCM payload. */
    private static void writeWavFile(File file, byte[] pcmData, int sampleRate, int channels) throws IOException {
        int byteRate = sampleRate * channels * (BITS_PER_SAMPLE / 8);
        int blockAlign = channels * (BITS_PER_SAMPLE / 8);
        int dataSize = pcmData.length;
        int chunkSize = 36 + dataSize;

        try (FileOutputStream out = new FileOutputStream(file)) {
            byte[] header = new byte[44];

            // RIFF chunk descriptor
            writeString(header, 0, "RIFF");
            writeIntLE(header, 4, chunkSize);
            writeString(header, 8, "WAVE");

            // fmt sub-chunk
            writeString(header, 12, "fmt ");
            writeIntLE(header, 16, 16);            // sub-chunk size (PCM)
            writeShortLE(header, 20, (short) 1);   // audio format = PCM
            writeShortLE(header, 22, (short) channels);
            writeIntLE(header, 24, sampleRate);
            writeIntLE(header, 28, byteRate);
            writeShortLE(header, 32, (short) blockAlign);
            writeShortLE(header, 34, (short) BITS_PER_SAMPLE);

            // data sub-chunk
            writeString(header, 36, "data");
            writeIntLE(header, 40, dataSize);

            out.write(header);
            out.write(pcmData);
            out.flush();
        }
    }

    private static void writeString(byte[] buf, int offset, String s) {
        for (int i = 0; i < s.length(); i++) buf[offset + i] = (byte) s.charAt(i);
    }

    private static void writeIntLE(byte[] buf, int offset, int value) {
        buf[offset] = (byte) (value & 0xff);
        buf[offset + 1] = (byte) ((value >> 8) & 0xff);
        buf[offset + 2] = (byte) ((value >> 16) & 0xff);
        buf[offset + 3] = (byte) ((value >> 24) & 0xff);
    }

    private static void writeShortLE(byte[] buf, int offset, short value) {
        buf[offset] = (byte) (value & 0xff);
        buf[offset + 1] = (byte) ((value >> 8) & 0xff);
    }
}
