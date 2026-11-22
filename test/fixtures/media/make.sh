#!/usr/bin/env bash
# 生成资源嗅探测试用的小媒体文件（3 秒，160x90）。改了这里需要重新运行并提交生成的文件。
set -euo pipefail
cd "$(dirname "$0")"
rm -rf dash dash-webm hls-ts hls-aes hls-fmp4 track-*.m4s track-*.webm sample.webm
SRC=(-f lavfi -i "testsrc2=size=160x90:rate=15:duration=3" -f lavfi -i "sine=frequency=440:duration=3")
Q=(-hide_banner -loglevel error -y)

# 整个文件：浏览器可以直接播的 WebM
ffmpeg "${Q[@]}" "${SRC[@]}" -c:v libvpx-vp9 -b:v 60k -c:a libopus -b:a 24k -shortest sample.webm

# 像 B 站那样：视频轨、音频轨各一个分片 MP4 文件
FRAG=(-f mp4 -movflags frag_keyframe+empty_moov+default_base_moof -frag_duration 1000000)
ffmpeg "${Q[@]}" "${SRC[@]}" -map 0:v -c:v libvpx-vp9 -b:v 60k -g 15 "${FRAG[@]}" track-video.m4s
ffmpeg "${Q[@]}" "${SRC[@]}" -map 1:a -c:a libopus -b:a 24k "${FRAG[@]}" track-audio.m4s

# WebM 格式的音视频分开（YouTube 的 VP9 + Opus 就是这样）
ffmpeg "${Q[@]}" "${SRC[@]}" -map 0:v -c:v libvpx-vp9 -b:v 60k -g 15 -cluster_time_limit 1000 track-video.webm
ffmpeg "${Q[@]}" "${SRC[@]}" -map 1:a -c:a libopus -b:a 24k -cluster_time_limit 1000 track-audio.webm

# DASH：SegmentTemplate + SegmentTimeline，音视频分开
mkdir dash
ffmpeg "${Q[@]}" "${SRC[@]}" -map 0:v -map 1:a -c:v libvpx-vp9 -b:v 60k -g 15 -c:a libopus -b:a 24k \
  -f dash -dash_segment_type mp4 -seg_duration 1 -use_template 1 -use_timeline 1 dash/stream.mpd

# DASH：WebM 分片（VP9 + Opus），合并后是一个 WebM
mkdir dash-webm
ffmpeg "${Q[@]}" "${SRC[@]}" -map 0:v -map 1:a -c:v libvpx-vp9 -b:v 60k -g 15 -c:a libopus -b:a 24k \
  -f dash -dash_segment_type webm -seg_duration 1 -use_template 1 -use_timeline 1 dash-webm/stream.mpd

# HLS：TS 分片（H.264 + AAC）
mkdir hls-ts
ffmpeg "${Q[@]}" "${SRC[@]}" -c:v libx264 -preset veryfast -b:v 60k -g 15 -c:a aac -b:a 32k -shortest \
  -f hls -hls_time 1 -hls_playlist_type vod -hls_segment_filename 'hls-ts/seg%d.ts' hls-ts/index.m3u8

# HLS：AES-128 加密的 TS 分片
mkdir hls-aes
printf '0123456789abcdef' > hls-aes/key.bin
printf 'key.bin\nhls-aes/key.bin\n00000000000000000000000000000001\n' > hls-aes/keyinfo
ffmpeg "${Q[@]}" "${SRC[@]}" -c:v libx264 -preset veryfast -b:v 60k -g 15 -c:a aac -b:a 32k -shortest \
  -f hls -hls_time 1 -hls_playlist_type vod -hls_key_info_file hls-aes/keyinfo -hls_segment_filename 'hls-aes/seg%d.ts' hls-aes/index.m3u8
rm hls-aes/keyinfo

# HLS：fMP4 分片，主列表 + 一路码率
mkdir hls-fmp4
ffmpeg "${Q[@]}" "${SRC[@]}" -c:v libvpx-vp9 -b:v 60k -g 15 -c:a libopus -b:a 24k -shortest \
  -f hls -hls_time 1 -hls_playlist_type vod -hls_segment_type fmp4 -hls_fmp4_init_filename init.mp4 \
  -hls_segment_filename 'hls-fmp4/seg%d.m4s' hls-fmp4/media.m3u8
printf '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=90000,RESOLUTION=160x90\nmedia.m3u8\n' > hls-fmp4/master.m3u8
