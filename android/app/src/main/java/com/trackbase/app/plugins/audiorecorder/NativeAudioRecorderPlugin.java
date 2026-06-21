package com.trackbase.app.plugins.audiorecorder;

import android.Manifest;
import android.content.Context;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.AudioTimestamp;
import android.media.MediaRecorder;
import android.os.Build;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.util.Arrays;

/**
 * Native microphone capture using {@link AudioRecord} (raw PCM), bypassing the
 * Android WebView audio stack entirely. Captured PCM is accumulated on a
 * background thread and written to a standard 16-bit WAV file in the app cache
 * directory on stop.
 *
 * <p>Latency: capture is configured for the lowest-latency path the device
 * offers — the HAL's native sample rate (so no resampler is inserted, which is
 * what forces the slow "deep buffer" path), a buffer sized to the native burst,
 * and {@code PERFORMANCE_MODE_LOW_LATENCY} on API 26+. The true input latency is
 * additionally measured at runtime via {@link AudioRecord#getTimestamp} and
 * reported back so the JS layer can align the take exactly instead of guessing.
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
    // Preferred native HAL rates, in order. The fast (low-latency) capture path
    // is only available at the device's native rate — anything else inserts a
    // resampler and drops you onto the high-latency deep-buffer path.
    private static final int[] PREFERRED_RATES = { 48000, 44100 };
    // Sample rates to try (in order) when the requested rate isn't supported.
    private static final int[] FALLBACK_RATES = { 48000, 44100, 32000, 22050, 16000, 11025, 8000 };
    // Cap a single recording at 10 minutes — pre-allocate the PCM buffer for this
    // so the capture thread never touches the allocator (avoids GC-induced jitter).
    private static final int MAX_RECORDING_SECONDS = 60 * 10;
    // Fallback HAL burst size (frames) when the device doesn't report one.
    private static final int DEFAULT_FRAMES_PER_BURST = 192;

    private AudioRecord audioRecord;
    private Thread recordingThread;
    private volatile boolean isRecording = false;

    private byte[] pcmPrealloc;
    private volatile int pcmBytesWritten;
    private int actualSampleRate;
    private int channelCount = 1;
    private int framesPerBurst = DEFAULT_FRAMES_PER_BURST;
    private boolean lowLatencyRequested = false;
    // Measured end-to-end input latency (sound at mic → frame available to read),
    // in milliseconds. Updated on the capture thread from AudioRecord timestamps.
    private volatile double measuredInputLatencyMs = -1;

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

        // The requested rate is only a hint. We strongly prefer the device's
        // native HAL rate so the fast/low-latency capture path is available;
        // resampling to an arbitrary rate is the single biggest latency source.
        int requestedRate = call.getInt("sampleRate", 48000);
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

        framesPerBurst = queryFramesPerBurst();
        int bytesPerFrame = channelCount * (BITS_PER_SAMPLE / 8);
        // Keep the buffer just large enough to stay glitch-free (a couple of HAL
        // bursts) but small enough to qualify for the fast track. Never go below
        // the framework minimum.
        int desiredBuffer = framesPerBurst * bytesPerFrame * 2;
        final int bufferSize = Math.max(minBuffer, desiredBuffer);

        // UNPROCESSED (API 24+) gives the rawest, lowest-latency capture with no
        // OS-side AGC/noise suppression. VOICE_RECOGNITION is the closest
        // low-latency, minimally-processed source on older devices.
        int audioSource = Build.VERSION.SDK_INT >= 24
            ? MediaRecorder.AudioSource.UNPROCESSED
            : MediaRecorder.AudioSource.VOICE_RECOGNITION;

        AudioRecord recorder;
        try {
            recorder = buildRecorder(audioSource, sampleRate, bufferSize);
        } catch (IllegalArgumentException e) {
            call.reject("Failed to create AudioRecord: " + e.getMessage());
            return;
        }

        if (recorder == null || recorder.getState() != AudioRecord.STATE_INITIALIZED) {
            if (recorder != null) recorder.release();
            call.reject("AudioRecord failed to initialize");
            return;
        }

        audioRecord = recorder;
        actualSampleRate = sampleRate;
        measuredInputLatencyMs = -1;

        // Pre-allocate the full PCM buffer up front so the capture thread only
        // ever does an arraycopy — never an allocation that could stall it.
        int maxBytes = actualSampleRate * bytesPerFrame * MAX_RECORDING_SECONDS;
        pcmPrealloc = new byte[maxBytes];
        pcmBytesWritten = 0;

        try {
            audioRecord.startRecording();
        } catch (IllegalStateException e) {
            releaseRecorder();
            call.reject("Failed to start recording: " + e.getMessage());
            return;
        }

        isRecording = true;

        final int readChunk = framesPerBurst * bytesPerFrame;
        recordingThread = new Thread(() -> readLoop(readChunk), "NativeAudioRecorderThread");
        recordingThread.start();

        JSObject ret = new JSObject();
        ret.put("sampleRate", actualSampleRate);
        ret.put("framesPerBurst", framesPerBurst);
        ret.put("lowLatency", lowLatencyRequested);
        ret.put("estimatedLatencyMs", estimateConfiguredLatencyMs(bufferSize, bytesPerFrame));
        call.resolve(ret);
    }

    private AudioRecord buildRecorder(int audioSource, int sampleRate, int bufferSize) {
        AudioFormat format = new AudioFormat.Builder()
            .setEncoding(AUDIO_FORMAT)
            .setSampleRate(sampleRate)
            .setChannelMask(CHANNEL_CONFIG)
            .build();

        AudioRecord.Builder builder = new AudioRecord.Builder()
            .setAudioSource(audioSource)
            .setAudioFormat(format)
            .setBufferSizeInBytes(bufferSize);

        // PERFORMANCE_MODE_LOW_LATENCY (API 26+) asks the framework for the FAST
        // capture track. Combined with the native rate + small buffer this is
        // what actually brings input latency down into the tens-of-ms range.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                builder.setPerformanceMode(AudioRecord.PERFORMANCE_MODE_LOW_LATENCY);
                lowLatencyRequested = true;
            } catch (Exception ignored) {
                lowLatencyRequested = false;
            }
        }

        return builder.build();
    }

    private void readLoop(int readChunkBytes) {
        // Run the capture loop at the dedicated audio priority so the OS
        // scheduler keeps the buffer drained and latency low.
        android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_URGENT_AUDIO);

        byte[] buffer = new byte[readChunkBytes];
        final byte[] dest = pcmPrealloc;
        final int capacity = dest != null ? dest.length : 0;
        final int bytesPerFrame = channelCount * (BITS_PER_SAMPLE / 8);
        final int rate = actualSampleRate;

        final AudioTimestamp timestamp = new AudioTimestamp();
        long framesRead = 0;
        long nextMeasureFrames = rate / 2;          // first measurement after ~0.5s warm-up
        final long measureIntervalFrames = rate / 5; // then refresh ~5×/sec

        while (isRecording) {
            AudioRecord recorder = audioRecord;
            if (recorder == null) break;
            int read = recorder.read(buffer, 0, buffer.length);
            if (read > 0) {
                long readAtNanos = System.nanoTime();
                int remaining = capacity - pcmBytesWritten;
                if (remaining <= 0) break;            // 10-minute cap reached
                int toCopy = Math.min(read, remaining);
                System.arraycopy(buffer, 0, dest, pcmBytesWritten, toCopy);
                pcmBytesWritten += toCopy;
                framesRead += toCopy / bytesPerFrame;
                if (framesRead >= nextMeasureFrames) {
                    nextMeasureFrames = framesRead + measureIntervalFrames;
                    measureLatency(recorder, timestamp, framesRead, readAtNanos, rate);
                }
                if (toCopy < read) break;             // buffer full, stop cleanly
            } else if (read == AudioRecord.ERROR_INVALID_OPERATION || read == AudioRecord.ERROR_BAD_VALUE) {
                break;
            }
        }
    }

    /**
     * Estimate true input latency from an {@link AudioTimestamp}: the timestamp
     * says {@code framePosition} frames had been captured by the HAL as of
     * {@code nanoTime}. The frame we just consumed ({@code framesRead}) was
     * captured earlier, so latency ≈ time-since-timestamp plus the frames still
     * buffered ahead of our read position.
     */
    private void measureLatency(AudioRecord recorder, AudioTimestamp ts, long framesRead, long readAtNanos, int rate) {
        if (rate <= 0) return;
        try {
            int status = recorder.getTimestamp(ts, AudioTimestamp.TIMEBASE_MONOTONIC);
            if (status != AudioRecord.SUCCESS) return;
            long framesAhead = ts.framePosition - framesRead;
            if (framesAhead < 0) framesAhead = 0;
            double latencyMs =
                (readAtNanos - ts.nanoTime) / 1_000_000.0
                + (framesAhead * 1000.0) / rate;
            if (latencyMs < 0) latencyMs = 0;
            if (latencyMs > 500) latencyMs = 500;     // clamp absurd outliers
            measuredInputLatencyMs = latencyMs;
        } catch (Exception ignored) {
            // getTimestamp unsupported on this device — leave the estimate as-is.
        }
    }

    @PluginMethod
    public void stopRecording(PluginCall call) {
        if (!isRecording && audioRecord == null) {
            call.reject("Not recording");
            return;
        }

        stopAndJoin();

        // The capture thread has joined, so pcmBytesWritten is final and visible.
        byte[] pcmData = pcmPrealloc != null
            ? Arrays.copyOf(pcmPrealloc, pcmBytesWritten)
            : new byte[0];
        pcmPrealloc = null;
        pcmBytesWritten = 0;
        double inputLatencyMs = measuredInputLatencyMs;
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
        // Measured end-to-end input latency. -1 when the device couldn't report
        // timestamps; the JS layer falls back to a fixed estimate in that case.
        ret.put("inputLatencyMs", inputLatencyMs);
        call.resolve(ret);
    }

    @PluginMethod
    public void cancelRecording(PluginCall call) {
        stopAndJoin();
        pcmPrealloc = null;
        pcmBytesWritten = 0;
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

    /** Resolve the capture rate: prefer the device native rate, then the
     *  requested rate, then a descending fallback list. */
    private int resolveSampleRate(int requested) {
        int nativeRate = queryNativeSampleRate();
        if (nativeRate > 0 && isSampleRateSupported(nativeRate)) return nativeRate;
        for (int rate : PREFERRED_RATES) {
            if (isSampleRateSupported(rate)) return rate;
        }
        if (isSampleRateSupported(requested)) return requested;
        for (int rate : FALLBACK_RATES) {
            if (rate != requested && isSampleRateSupported(rate)) return rate;
        }
        return -1;
    }

    private int queryNativeSampleRate() {
        try {
            AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
            if (am == null) return -1;
            String rate = am.getProperty(AudioManager.PROPERTY_OUTPUT_SAMPLE_RATE);
            if (rate != null) return Integer.parseInt(rate);
        } catch (Exception ignored) {
            // fall through to defaults
        }
        return -1;
    }

    private int queryFramesPerBurst() {
        try {
            AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
            if (am == null) return DEFAULT_FRAMES_PER_BURST;
            String frames = am.getProperty(AudioManager.PROPERTY_OUTPUT_FRAMES_PER_BUFFER);
            if (frames != null) {
                int parsed = Integer.parseInt(frames);
                if (parsed > 0) return parsed;
            }
        } catch (Exception ignored) {
            // fall through to default
        }
        return DEFAULT_FRAMES_PER_BURST;
    }

    private double estimateConfiguredLatencyMs(int bufferSizeBytes, int bytesPerFrame) {
        if (actualSampleRate <= 0 || bytesPerFrame <= 0) return -1;
        int frames = bufferSizeBytes / bytesPerFrame;
        return (frames * 1000.0) / actualSampleRate;
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
        pcmPrealloc = null;
        pcmBytesWritten = 0;
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
