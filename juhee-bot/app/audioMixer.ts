// import { PassThrough, Readable } from 'stream';
// import { logger } from './logger.js';
// import { createAudioResource, AudioResource, StreamType } from '@discordjs/voice';
// import pkg from '@discordjs/opus';
// const { OpusEncoder } = pkg;

// interface AudioInput {
//   id: string;
//   userId: string;
//   voice: string;
//   audioStream: Readable;
//   pcmBuffer: Buffer[];
//   isActive: boolean;
//   timestamp: number;
//   totalSamples: number;
// }

// export class AudioMixer extends PassThrough {
//   private inputs: Map<string, AudioInput> = new Map();
//   private opusEncoder: InstanceType<typeof OpusEncoder>;
//   private masterAudioResource: AudioResource | null = null;
//   private isRunning = false;
//   private maxInputs = 6;
//   private sampleRate = 48000;
//   private channels = 2; // Stereo for Discord
//   private frameSize = 960; // 20ms at 48kHz (Discord standard)
//   private mixingInterval: NodeJS.Timeout | null = null;
//   private silenceFrame: Buffer;
//   private lastMixedFrame: Buffer | null = null;

//   constructor() {
//     super({
//       readableObjectMode: false,
//       writableObjectMode: false,
//       highWaterMark: 1024 * 64,
//       allowHalfOpen: true
//     });
    
//     // Opus 인코더 초기화 (Stereo)
//     this.opusEncoder = new OpusEncoder(this.sampleRate, this.channels);
    
//     // 무음 프레임 생성 (20ms stereo)
//     this.silenceFrame = Buffer.alloc(this.frameSize * this.channels * 2, 0); // 960 samples * 2 channels * 2 bytes
    
//     // 스트림 에러 핸들링
//     this.on('error', (error: Error) => {
//       logger.error('🎛️ Audio mixer error:', error.message);
//     });
    
//     this.on('close', () => {
//       logger.debug('🎛️ Audio mixer closed');
//     });

//     // 믹싱 시작
//     this.startMixing();
//     this.isRunning = true;
    
//     logger.info('🎛️ PCM Audio Mixer initialized');
//   }

//   // 믹싱 프로세스 시작
//   private startMixing(): void {
//     // 20ms마다 믹싱 (Discord Opus 표준)
//     this.mixingInterval = setInterval(() => {
//       this.mixAndOutput();
//     }, 20);
//   }

//   // PCM 믹싱 및 출력
//   private mixAndOutput(): void {
//     const allInputs = Array.from(this.inputs.values()).filter(input => input.isActive);
//     const activeInputs = allInputs.filter(input => input.pcmBuffer.length > 0);
    
//     // 비활성화된 입력들 정리
//     const inactiveInputs = Array.from(this.inputs.values()).filter(input => !input.isActive);
//     for (const input of inactiveInputs) {
//       logger.debug(`🧹 Cleaning up inactive input: ${input.userId}`);
//       this.removeInput(input.id);
//     }
    
//     logger.info(`🔀 Mix cycle: ${activeInputs.length} active inputs (${allInputs.length} total), ${this.inputs.size} registered`);
//     for (const input of allInputs) {
//       const totalBytes = input.pcmBuffer.reduce((sum, buf) => sum + buf.length, 0);
//       logger.info(`📦 Input ${input.userId}: buffer chunks=${input.pcmBuffer.length}, total bytes=${totalBytes}, active=${input.pcmBuffer.length > 0}`);
//     }
    
//     if (activeInputs.length === 0) {
//               // 활성 입력이 없으면 무음 전송 (하지만 로그는 출력)
//         logger.info(`🔇 No active inputs with data, sending silence`);
//       this.sendSilence();
//       return;
//     }

//     // 각 입력에서 Mono PCM 데이터 수집
//     const monoFrames: Buffer[] = [];
    
//     for (const input of activeInputs) {
//       const monoFrame = this.extractPCMFrame(input);
//       if (monoFrame) {
//         monoFrames.push(monoFrame);
//       }
//     }

//     if (monoFrames.length === 0) {
//       // 데이터가 없으면 이전 프레임 반복하거나 무음
//       if (this.lastMixedFrame) {
//         this.sendPreviousFrame();
//       } else {
//         this.sendSilence();
//       }
//       return;
//     }

//     // Mono 프레임들을 믹싱하고 Stereo로 변환
//     const mixedStereoFrame = this.mixMonoFrames(monoFrames);
//     this.lastMixedFrame = mixedStereoFrame;
    
//     this.write(mixedStereoFrame);

//     // // Opus로 인코딩
//     // try {
//     //   // 데이터 검증
//     //   if (!mixedStereoFrame || mixedStereoFrame.length !== this.frameSize * this.channels * 2) {
//     //     logger.error(`🎛️ Invalid stereo frame size: ${mixedStereoFrame?.length || 0}, expected: ${this.frameSize * this.channels * 2}`);
//     //     this.sendSilence();
//     //     return;
//     //   }
      
//     //   const opusFrame = this.opusEncoder.encode(mixedStereoFrame);
      
//     //   // Opus 프레임 크기 검증 (3바이트는 거의 무음 상태)
//     //   if (opusFrame.length <= 5) {
//     //     logger.warn(`🎛️ Suspiciously small Opus frame: ${opusFrame.length} bytes, sending silence instead`);
//     //     this.sendSilence();
//     //     return;
//     //   }
      
//     //   logger.info(`🎵 Opus frame encoded: ${opusFrame.length} bytes, mixed from ${monoFrames.length} frames`);
//     //   this.write(opusFrame);
//     // } catch (error: any) {
//     //   logger.error('🎛️ Opus encoding error:', error.message);
//     //   this.sendSilence();
//     // }
//   }

//   // PCM 프레임 추출 (Mono 데이터용)
//   private extractPCMFrame(input: AudioInput): Buffer | null {
//     // Mono 프레임 크기 (나중에 Stereo로 변환)
//     const monoFrameBytes = this.frameSize * 2; // 16-bit mono: 960 samples * 2 bytes = 1920 bytes
    
//     // 버퍼 길이 계산
//     let totalBytes = 0;
//     for (const buffer of input.pcmBuffer) {
//       totalBytes += buffer.length;
//     }
    
//     // 최소 한 프레임이 있어야 함
//     if (totalBytes < monoFrameBytes) {
//       // 마지막 불완전한 청크가 있는 경우 패딩하여 처리
//       if (totalBytes > 0 && totalBytes < monoFrameBytes) {
//         logger.info(`📊 Incomplete frame from ${input.userId}: ${totalBytes}/${monoFrameBytes} bytes, padding with zeros`);
        
//         const paddedFrame = Buffer.alloc(monoFrameBytes, 0);
//         let written = 0;
        
//         // 기존 데이터 복사
//         while (written < totalBytes && input.pcmBuffer.length > 0) {
//           const buffer = input.pcmBuffer.shift()!;
//           buffer.copy(paddedFrame, written);
//           written += buffer.length;
//         }
        
//         // 나머지는 0으로 패딩됨 (이미 alloc으로 0으로 초기화됨)
//         logger.info(`📊 Padded frame created from ${input.userId}: ${written}/${monoFrameBytes} bytes (${Math.round(written/monoFrameBytes*100)}%)`);
        
//         // 입력을 비활성화하여 더 이상 처리하지 않도록
//         input.isActive = false;
        
//         return paddedFrame;
//       }
//       return null;
//     }
    
//     // Mono 프레임 추출
//     const monoFrame = Buffer.alloc(monoFrameBytes);
//     let written = 0;
    
//     while (written < monoFrameBytes && input.pcmBuffer.length > 0) {
//       const buffer = input.pcmBuffer[0];
//       const needed = monoFrameBytes - written;
      
//       if (buffer.length <= needed) {
//         // 전체 버퍼 사용
//         buffer.copy(monoFrame, written);
//         written += buffer.length;
//         input.pcmBuffer.shift();
//       } else {
//         // 부분 버퍼 사용
//         buffer.copy(monoFrame, written, 0, needed);
//         written += needed;
//         input.pcmBuffer[0] = buffer.slice(needed);
//       }
//     }
    
//     logger.info(`📊 Mono frame extracted from ${input.userId}: ${written}/${monoFrameBytes} bytes (${Math.round(written/monoFrameBytes*100)}%)`);
    
//     return monoFrame;
//   }

//   // Mono 프레임들을 믹싱하고 Stereo로 변환
//   private mixMonoFrames(monoFrames: Buffer[]): Buffer {
//     if (monoFrames.length === 1) {
//       // 단일 프레임은 바로 Stereo로 변환
//       return this.monoToStereo(monoFrames[0]);
//     }
    
//     // 여러 Mono 프레임을 먼저 믹싱
//     const monoSamples = this.frameSize; // 960 samples
//     const mixedMono = Buffer.alloc(monoSamples * 2); // 16-bit mono
    
//     // Mono 믹싱
//     for (let i = 0; i < monoSamples; i++) {
//       let sum = 0;
      
//       for (const frame of monoFrames) {
//         if (i * 2 + 1 < frame.length) {
//           const sample = frame.readInt16LE(i * 2);
//           sum += sample;
//         }
//       }
      
//       // 클리핑 방지 (소프트 클리핑)
//       const mixedSample = Math.max(-32768, Math.min(32767, Math.round(sum * 0.7)));
//       mixedMono.writeInt16LE(mixedSample, i * 2);
//     }
    
//     // 믹싱된 Mono를 Stereo로 변환
//     return this.monoToStereo(mixedMono);
//   }

//   // Mono PCM을 Stereo로 변환
//   private monoToStereo(monoFrame: Buffer): Buffer {
//     const monoSamples = monoFrame.length / 2; // 16-bit samples
//     const stereoFrame = Buffer.alloc(monoSamples * 4); // Stereo is double size
    
//     for (let i = 0; i < monoSamples; i++) {
//       const sample = monoFrame.readInt16LE(i * 2);
//       // 같은 샘플을 left, right 채널에 복사
//       stereoFrame.writeInt16LE(sample, i * 4);     // Left
//       stereoFrame.writeInt16LE(sample, i * 4 + 2); // Right
//     }
    
//     return stereoFrame;
//   }

//   // 무음 전송
//   private sendSilence(): void {
//     try {
//       const opusFrame = this.opusEncoder.encode(this.silenceFrame);
//       logger.info(`🔇 Silence frame sent: ${opusFrame.length} bytes`);
//       this.write(opusFrame);
//     } catch (error: any) {
//       logger.error('🎛️ Silence encoding error:', error.message);
//     }
//   }

//   // 이전 프레임 반복 전송
//   private sendPreviousFrame(): void {
//     if (!this.lastMixedFrame) {
//       this.sendSilence();
//       return;
//     }
    
//     try {
//       const opusFrame = this.opusEncoder.encode(this.lastMixedFrame);
//       this.write(opusFrame);
//     } catch (error: any) {
//       logger.error('🎛️ Previous frame encoding error:', error.message);
//       this.sendSilence();
//     }
//   }

//   // TTS 입력 추가
//   addInput(userId: string, audioStream: Readable, voice: string): AudioResource {
//     const inputId = `${userId}_${Date.now()}`;
    
//     const input: AudioInput = {
//       id: inputId,
//       userId,
//       voice,
//       audioStream,
//       pcmBuffer: [],
//       isActive: true,
//       timestamp: Date.now(),
//       totalSamples: 0
//     };
    
//     this.inputs.set(inputId, input);
//     logger.debug(`🎵 Added input: ${userId} (${voice}) - Total: ${this.inputs.size}`);
    
//     // PCM 스트림 처리
//     this.setupPCMProcessing(input);
    
//     // 15초 후 자동 정리
//     setTimeout(() => {
//       this.removeInput(inputId);
//     }, 15000);
    
//     // AudioResource 반환
//     return this.getOrCreateAudioResource();
//   }

//     // PCM 스트림 처리 설정 (강제 청킹)
//   private setupPCMProcessing(input: AudioInput): void {
//     let allData = Buffer.alloc(0);
//     let totalReceived = 0;
//     const chunkSize = 1920; // 20ms worth of mono 16-bit data at 48kHz (960 samples * 2 bytes)
    
//     // 모든 데이터를 먼저 수집
//     input.audioStream.on('data', (chunk: Buffer) => {
//       if (!input.isActive) return;
//       allData = Buffer.concat([allData, chunk]);
//       logger.info(`📥 Raw data received from ${input.userId}: ${chunk.length} bytes, total: ${allData.length}`);
//     });
    
//     input.audioStream.on('end', () => {
//       logger.info(`🎧 Processing complete stream from ${input.userId}: ${allData.length} bytes`);
      
//       // WAV 헤더 제거
//       let pcmData = allData;
//       if (allData.length >= 44) {
//         pcmData = allData.slice(44);
//         logger.info(`🎧 WAV header removed, PCM data: ${pcmData.length} bytes`);
//       }
      
//       if (pcmData.length > 0) {
//         // 강제로 청크 단위로 분할하여 시간차를 두고 버퍼에 추가
//         let offset = 0;
//         const addChunks = () => {
//           if (!input.isActive || offset >= pcmData.length) return;
          
//           // 한 번에 여러 청크 추가 (더 부드러운 재생)
//           const batchSize = chunkSize * 4; // 80ms 분량씩
//           const endOffset = Math.min(offset + batchSize, pcmData.length);
          
//           while (offset < endOffset) {
//             const chunk = pcmData.slice(offset, Math.min(offset + chunkSize, pcmData.length));
//             input.pcmBuffer.push(chunk);
//             offset += chunkSize;
//           }
          
//           totalReceived = offset;
//           input.totalSamples = totalReceived / 2;
          
//                      logger.info(`🎵 Batch added to buffer: ${input.userId}, chunks: ${input.pcmBuffer.length}, progress: ${Math.round(offset/pcmData.length*100)}%`);
          
//           // 다음 배치를 10ms 후에 추가
//           if (offset < pcmData.length) {
//             setTimeout(addChunks, 10);
//           }
//         };
        
//         // 즉시 첫 번째 배치 추가
//         addChunks();
//       }
      
//       logger.debug(`🎵 PCM stream finished: ${input.userId}, total: ${pcmData.length} bytes, ${Math.ceil(pcmData.length / chunkSize)} chunks`);
      
//       // 모든 데이터 처리 후 5초 후에 제거
//       setTimeout(() => {
//         logger.debug(`🎵 Removing input: ${input.userId}`);
//         this.removeInput(input.id);
//       }, 5000);
//     });
    
//     input.audioStream.on('error', (error: Error) => {
//       logger.error(`🎵 PCM stream error for ${input.userId}:`, error.message);
//       this.removeInput(input.id);
//     });
//   }

//   // PCM 버퍼 정리
//   private trimPCMBuffer(input: AudioInput, excessBytes: number): void {
//     let removed = 0;
//     while (removed < excessBytes && input.pcmBuffer.length > 0) {
//       const buffer = input.pcmBuffer[0];
//       if (buffer.length <= (excessBytes - removed)) {
//         removed += buffer.length;
//         input.pcmBuffer.shift();
//       } else {
//         const keepBytes = buffer.length - (excessBytes - removed);
//         input.pcmBuffer[0] = buffer.slice(excessBytes - removed);
//         removed = excessBytes;
//       }
//     }
//          input.totalSamples -= removed / 2; // 16-bit mono input
//   }

//   // AudioResource 생성/반환 (재사용)
//   private getOrCreateAudioResource(): AudioResource {
//     // 기존 리소스가 유효하면 재사용
//     if (this.masterAudioResource && !this.isResourceEnded()) {
//       logger.debug('🎛️ Reusing existing AudioResource');
//       return this.masterAudioResource;
//     }
    
//     logger.debug('🎛️ Creating new AudioResource for PCM mixer');
    
//     try {
//       const newAudioResource = createAudioResource(this, {
//         // inputType: StreamType.Opus,
//         inlineVolume: false
//       });
      
//       newAudioResource.playStream.on('error', (error: Error) => {
//         logger.error('🎛️ AudioResource playStream error:', error.message);
//       });
      
//       this.masterAudioResource = newAudioResource;
//       logger.debug('🎛️ New AudioResource created successfully');
      
//       return newAudioResource;
//     } catch (error: any) {
//       logger.error('🎛️ Failed to create AudioResource:', error.message);
//       throw error;
//     }
//   }

//   // AudioResource 종료 상태 확인
//   private isResourceEnded(): boolean {
//     if (!this.masterAudioResource) return true;
//     return this.masterAudioResource.playStream.destroyed || 
//            this.masterAudioResource.playStream.readableEnded;
//   }

//   // 입력 제거
//   removeInput(inputId: string): void {
//     if (this.inputs.has(inputId)) {
//       const input = this.inputs.get(inputId)!;
//       input.isActive = false;
//       this.inputs.delete(inputId);
//       logger.debug(`🗑️ Removed input: ${inputId}`);
//     }
//   }

//   // 최대 입력 수 설정
//   setMaxInputs(count: number): void {
//     this.maxInputs = Math.max(1, Math.min(10, count));
//     logger.info(`🎛️ Max inputs: ${this.maxInputs}`);
//   }

//   // 현재 상태
//   getStatus(): {
//     inputCount: number;
//     isRunning: boolean;
//     maxInputs: number;
//     activeInputs: Array<{userId: string, voice: string, age: number, bufferSize: number}>;
//   } {
//     const now = Date.now();
//     const activeInputs = Array.from(this.inputs.values())
//       .filter(input => input.isActive)
//       .map(input => ({
//         userId: input.userId,
//         voice: input.voice,
//         age: Math.round((now - input.timestamp) / 1000),
//         bufferSize: input.pcmBuffer.reduce((sum, buf) => sum + buf.length, 0)
//       }));

//     return {
//       inputCount: this.inputs.size,
//       isRunning: this.isRunning,
//       maxInputs: this.maxInputs,
//       activeInputs
//     };
//   }

//   // 출력 스트림 반환
//   getOutputStream(): PassThrough {
//     return this;
//   }

//   // 현재 활성 입력 수
//   getActiveInputCount(): number {
//     return Array.from(this.inputs.values()).filter(input => input.isActive).length;
//   }

//   // 모든 입력 정리
//   clear(): void {
//     for (const input of this.inputs.values()) {
//       input.isActive = false;
//     }
//     this.inputs.clear();
//     logger.info('🧹 Cleared all inputs');
//   }

//   // 소멸자
//   destroy(error?: Error): this {
//     this.isRunning = false;
    
//     if (this.mixingInterval) {
//       clearInterval(this.mixingInterval);
//       this.mixingInterval = null;
//     }
    
//     this.clear();
//     this.end();
//     logger.info('🎛️ PCM Audio Mixer destroyed');
    
//     return super.destroy(error);
//   }
// } 