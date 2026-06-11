-- Default track icon background: light purple (matches icon picker palette)
alter table tracks alter column icon_color set default 'rgba(167,139,250,0.15)';

update tracks
set icon_color = 'rgba(167,139,250,0.15)'
where icon_color is null or icon_color = '#0d0d1f';
