/**
 * @fileoverview Discord 인터랙션 및 메시지 액션 처리 클래스
 * @description 음성 채널 입/퇴장, 메시지 전송, 응답 관리 등을 처리
 * @author kevin1113dev
 */

import {
  ChatInputCommandInteraction,
  DiscordAPIError,
  GuildMember,
  Interaction,
  Message,
  MessageFlags,
  PartialGroupDMChannel,
  VoiceBasedChannel,
} from "discord.js";
import {
  AudioPlayer,
  DiscordGatewayAdapterCreator,
  VoiceConnection,
  VoiceConnectionStatus,
  getVoiceConnection,
  joinVoiceChannel,
} from "@discordjs/voice";
import { Servers } from "./dbObject.js";
import { DATA } from "./types.js";
import { logger } from "./logger.js";

/**
 * Discord 인터랙션 및 메시지 액션을 처리하는 클래스
 * 
 * @remarks
 * 음성 채널 연결, 메시지 전송, 응답 관리 등의 기능을 제공
 */
export default class Action {
  /** 현재 처리 중인 인터랙션 또는 메시지 */
  interaction: Interaction | Message | null;
  
  /** 이미 응답을 보냈는지 여부를 추적 */
  isReplied = false;

  /**
   * Action 클래스 생성자
   * 
   * @param interaction - Discord 인터랙션 또는 메시지 객체 (선택적)
   */
  constructor(interaction: Interaction | Message | null = null) {
    this.interaction = interaction;
    this.isReplied = false;
  }

  /**
   * 새로운 인터랙션 또는 메시지를 설정
   * 메시지나 슬래시 커맨드 입력 시 호출
   * 
   * @param interaction - 새로운 인터랙션 또는 메시지
   */
  setInteraction(interaction: Interaction | Message) {
    this.interaction = interaction;
    this.isReplied = false;
  }

  /**
   * 음성 채널에서 나가기
   * 현재 연결된 음성 채널에서 봇을 제거
   * 
   * @throws {Error} 음성 채널 퇴장 중 오류 발생 시
   */
  async exitVoiceChannel(guildData?: any) {
    try {
      if (!this.interaction) return;
      if (!this.interaction.guildId) return;

      const voiceConnection: VoiceConnection | undefined = getVoiceConnection(
        this.interaction.guildId
      );
      if (!voiceConnection) {
        await this.reply("음성채널에 연결되어 있지 않습니다");
        return;
      } else {
        voiceConnection.destroy();
        
        // 타임아웃 정리
        if (guildData?.timeOut) {
          clearTimeout(guildData.timeOut);
          guildData.timeOut = null;
        }
        
        // 오디오 플레이어 정리
        if (guildData?.audioPlayer) {
          guildData.audioPlayer.stop();
          guildData.audioPlayer = null;
        }
        
        await this.reply("음성채널 나감");
        const guildName = this.interaction instanceof Message 
          ? this.interaction.guild?.name 
          : (this.interaction as ChatInputCommandInteraction).guild?.name;
        logger.info(
          `🚪 음성 채널 퇴장: 서버 '${guildName}' (ID: ${this.interaction.guildId})`
        );
        return;
      }
    } catch (error) {
      const guildName = this.interaction instanceof Message 
        ? this.interaction.guild?.name 
        : (this.interaction as ChatInputCommandInteraction).guild?.name;
      logger.error(
        `❌ 음성 채널 퇴장 실패: 서버 '${guildName}' (ID: ${this.interaction?.guildId})`,
        error
      );
      await this.reply("음성채널 나가기 중 오류가 발생했습니다.");
    }
  }

  /**
   * 음성 채널에 입장
   * 사용자가 있는 음성 채널에 봇을 연결하고 오디오 플레이어를 구독
   * 
   * @param audioPlayer - 구독할 오디오 플레이어
   * @throws {Error} 음성 채널 입장 중 오류 발생 시
   * 
   * @remarks
   * - 사용자가 음성 채널에 있어야 함
   * - 자동 재연결 및 오류 처리 포함
   */
  async joinVoiceChannel(audioPlayer: AudioPlayer) {
    try {
      if (!this.interaction) return;
      if (
        !this.interaction.guildId ||
        !(this.interaction.member instanceof GuildMember)
      )
        return;

      const voiceChannel: VoiceBasedChannel | null =
        this.interaction.member.voice.channel;
      if (!voiceChannel) {
        await this.reply("음성 채널에 먼저 접속해주세요");
        return;
      }

      const voiceConnection: VoiceConnection | undefined = getVoiceConnection(
        this.interaction.guildId
      );
      if (
        !voiceConnection ||
        voiceConnection.joinConfig.channelId != voiceChannel.id
      ) {
        const connection = joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId: voiceChannel.guild.id,
          adapterCreator: voiceChannel.guild.voiceAdapterCreator as DiscordGatewayAdapterCreator,
          selfDeaf: true,
          selfMute: false,
        });
        
        connection.subscribe(audioPlayer);
        
        // 음성 연결 상태 이벤트 핸들러 설정
        this.setupVoiceConnectionHandlers(connection, voiceChannel, audioPlayer);
        
        await this.reply("음성 채널 접속 성공");
        logger.info(
          `🔊 음성 채널 입장: 서버 '${voiceChannel.guild.name}' (ID: ${this.interaction.guildId}) | 채널: '${voiceChannel.name}' (ID: ${voiceChannel.id})`
        );
        return;
      } else {
        // 기존 연결이 있을 경우 핸들러 재설정
        this.setupVoiceConnectionHandlers(voiceConnection, voiceChannel, audioPlayer);
        await this.reply("이미 접속 되어 있습니다");
        return;
      }
    } catch (error) {
      const guildName = this.interaction instanceof Message 
        ? this.interaction.guild?.name 
        : (this.interaction as ChatInputCommandInteraction).guild?.name;
      logger.error(
        `❌ 음성 채널 입장 실패: 서버 '${guildName}' (ID: ${this.interaction?.guildId})`,
        error
      );
      await this.reply("음성채널 접속 중 오류가 발생했습니다.");
    }
  }

  /**
   * 음성 연결 상태 이벤트 핸들러 설정
   * 연결 끊김, 오류, 재연결 등을 처리
   * 
   * @param connection - 음성 연결 객체
   * @param voiceChannel - 음성 채널 객체
   * @param audioPlayer - 오디오 플레이어
   * @param retryCount - 재시도 횟수 (기본값: 0)
   * 
   * @remarks
   * - 최대 3번까지 재연결 시도
   * - 5초 간격으로 재연결 시도
   */
  private setupVoiceConnectionHandlers(
    connection: VoiceConnection, 
    voiceChannel: VoiceBasedChannel, 
    audioPlayer: AudioPlayer,
    retryCount: number = 0
  ) {
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 5000; // 5초
    
    // 연결 끊김 상태 처리
    connection.on(VoiceConnectionStatus.Disconnected, async (oldState, newState) => {
      try {
        logger.warn(
          `🔌 음성 연결 끊김: 서버 '${voiceChannel.guild.name}' (ID: ${voiceChannel.guild.id}) | 채널: '${voiceChannel.name}'`
        );
        
        // 재연결 시도 (최대 5초 대기)
        await Promise.race([
          connection.configureNetworking(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('ETIMEDOUT')), 5000)
          )
        ]);
        
        logger.info(
          `🔌 음성 연결 복구됨: 서버 '${voiceChannel.guild.name}' (ID: ${voiceChannel.guild.id})`
        );
      } catch (error) {
        logger.error(
          `🔌 음성 연결 재시도 중: 서버 '${voiceChannel.guild.name}' (${retryCount + 1}/${MAX_RETRIES})`,
          error
        );
        
        if (retryCount < MAX_RETRIES) {
          // 재연결 시도
          setTimeout(() => {
            this.reconnectVoiceChannel(voiceChannel, audioPlayer, retryCount + 1).catch((err) => {
              logger.error(`🔌 재연결 중 예외 발생: 서버 '${voiceChannel.guild.name}'`, err);
            });
          }, RETRY_DELAY);
        } else {
          logger.reconnectionFailed(error);
          connection.destroy();
        }
      }
    });

    // 연결 준비 완료 상태
    connection.on(VoiceConnectionStatus.Ready, () => {
      logger.info(
        `🔌 음성 연결 준비 완료: 서버 '${voiceChannel.guild.name}' (ID: ${voiceChannel.guild.id})`
      );
    });

    // 일반 오류 처리
    connection.on('error', (error) => {
      try {
        logger.error(
          `🔌 음성 연결 오류: 서버 '${voiceChannel.guild.name}' (ID: ${voiceChannel.guild.id})`,
          error
        );
        
        // 타임아웃 에러의 경우 재연결 시도
        if (error.message?.includes('ETIMEDOUT') && retryCount < MAX_RETRIES) {
          logger.warn(
            `🔌 타임아웃 오류, 재연결 시도: 서버 '${voiceChannel.guild.name}' (${retryCount + 1}/${MAX_RETRIES})`
          );
          setTimeout(() => {
            this.reconnectVoiceChannel(voiceChannel, audioPlayer, retryCount + 1).catch((err) => {
              logger.error(`🔌 재연결 중 예외 발생: 서버 '${voiceChannel.guild.name}'`, err);
            });
          }, RETRY_DELAY);
        } else {
          logger.reconnectionFailed(error);
        }
      } catch (handlerError) {
        logger.error(`🔌 에러 핸들러 내부 오류: 서버 '${voiceChannel.guild.name}'`, handlerError);
      }
    });

    // 상태 변화 디버그 로깅
    connection.on('stateChange', (oldState, newState) => {
      try {
        logger.debug(
          `🔌 음성 연결 상태 변경: ${oldState.status} -> ${newState.status} (서버: '${voiceChannel.guild.name}')`
        );
      } catch (stateChangeError) {
        logger.error('🔌 상태 변경 로깅 오류:', stateChangeError);
      }
    });
  }

  /**
   * 음성 채널 재연결 시도
   * 연결이 끊어졌을 때 자동으로 재연결 시도
   * 
   * @param voiceChannel - 재연결할 음성 채널
   * @param audioPlayer - 오디오 플레이어
   * @param retryCount - 현재 재시도 횟수 (기본값: 0)
   * 
   * @remarks
   * - 최대 3번까지 재시도
   * - 점진적으로 대기 시간 증가
   * - 채널 접근 권한 및 존재 여부 확인
   */
  private async reconnectVoiceChannel(
    voiceChannel: VoiceBasedChannel, 
    audioPlayer: AudioPlayer, 
    retryCount: number = 0
  ) {
    try {
      // 채널 존재 여부 및 접근 가능 여부 확인
      const guild = voiceChannel.guild;
      try {
        const refreshedChannel = await guild.channels.fetch(voiceChannel.id);
        if (!refreshedChannel || !refreshedChannel.isVoiceBased()) {
          logger.warn(
            `🔌 음성 채널이 삭제되었거나 접근할 수 없음: 서버 '${guild.name}' | 채널 ID: ${voiceChannel.id}`
          );
          return; // 재연결 중단
        }
        
        // 봇 멤버 객체 확인
        if (!guild.members.me) {
          logger.warn(
            `🔌 봇 멤버 정보를 가져올 수 없음: 서버 '${guild.name}'`
          );
          return; // 재연결 중단
        }
        
        // 봇이 채널에 접근할 수 있는지 권한 확인
        const permissions = refreshedChannel.permissionsFor(guild.members.me);
        if (!permissions?.has(['Connect', 'Speak'])) {
          logger.warn(
            `🔌 음성 채널 접근 권한 없음: 서버 '${guild.name}' | 채널: '${refreshedChannel.name}'`
          );
          return; // 재연결 중단
        }
      } catch (fetchError) {
        logger.error(
          `🔌 채널 정보 가져오기 실패: 서버 '${guild.name}' | 채널 ID: ${voiceChannel.id}`,
          fetchError
        );
        return; // 재연결 중단
      }
      
      logger.info(
        `🔌 음성 채널 재연결 시도: 서버 '${voiceChannel.guild.name}' | 채널: '${voiceChannel.name}' (${retryCount}번째 시도)`
      );
      
      // 기존 연결 정리
      const existingConnection = getVoiceConnection(voiceChannel.guild.id);
      if (existingConnection) {
        existingConnection.destroy();
      }

      // 새로운 연결 생성 (타임아웃 처리)
      const connection = await Promise.race([
        new Promise<VoiceConnection>((resolve) => {
          const conn = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: voiceChannel.guild.id,
            adapterCreator: voiceChannel.guild.voiceAdapterCreator as DiscordGatewayAdapterCreator,
            selfDeaf: true,
            selfMute: false,
          });
          
          // 연결이 준비되면 resolve
          conn.on(VoiceConnectionStatus.Ready, () => resolve(conn));
          
          // 연결 실패 시에도 일단 반환 (핸들러에서 처리)
          setTimeout(() => resolve(conn), 2000);
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Connection timeout')), 10000)
        )
      ]);
      
      connection.subscribe(audioPlayer);
      this.setupVoiceConnectionHandlers(connection, voiceChannel, audioPlayer, retryCount);
      
      logger.info(
        `🔌 음성 채널 재연결 성공: 서버 '${voiceChannel.guild.name}' | 채널: '${voiceChannel.name}'`
      );
    } catch (error) {
      logger.error(
        `🔌 음성 채널 재연결 실패: 서버 '${voiceChannel.guild.name}' | 채널: '${voiceChannel.name}' (${retryCount}번째 시도)`,
        error
      );
      
      // 최대 재시도 횟수에 도달하지 않았다면 다시 시도
      if (retryCount < 3) {
        setTimeout(() => {
          this.reconnectVoiceChannel(voiceChannel, audioPlayer, retryCount + 1);
        }, 5000 * (retryCount + 1)); // 점진적으로 대기 시간 증가 (5초, 10초, 15초)
      } else {
        logger.error(
          `🔌 최대 재연결 시도 횟수 도달, 재연결 포기: 서버 '${voiceChannel.guild.name}'`
        );
      }
    }
  }

  /**
   * 채널에 메시지 전송
   * 음소거 상태와 권한을 확인하여 메시지 전송
   * 
   * @param msg - 전송할 메시지 내용
   * @throws {Error} 메시지 전송 중 오류 발생 시
   */
  async send(msg: string): Promise<void> {
    try {
      if (!this.interaction) return;
      if (!this.interaction.channel) {
        return;
      }
      if (this.interaction.channel instanceof PartialGroupDMChannel) {
        return;
      }

      const server: DATA | null = await Servers.findOne({
        where: { id: this.interaction.guildId },
      });
      if (!server) {
        logger.serverNotRegistered();
        return;
      }
      if (server.dataValues.isMuted) return;

      try {
        await this.interaction.channel.send(msg);
      } catch (err) {
        // 권한 없음 오류(50013) 처리
        if (err instanceof DiscordAPIError && err.code === 50013) {
          logger.error("채널에서 메시지 전송 권한 없음", err);
          return;
        }
        throw err;
      }
    } catch (error) {
      logger.error("메시지 전송 실패:", error);
    }
  }

  /**
   * 인터랙션 응답 유예
   * 3초 이내에 응답하지 못할 것 같을 때 호출하여 시간 연장
   * 
   * @param ephemeral - 다른 사용자에게 보이지 않게 할지 여부 (기본값: false)
   */
  async deferReply(ephemeral: boolean = false): Promise<void> {
    try {
      if (!this.interaction) return;
      if (this.interaction instanceof Message) return;
      if (!this.interaction.isChatInputCommand()) return;
      if (this.isReplied) return;

      await this.interaction.deferReply({ 
        flags: ephemeral ? MessageFlags.Ephemeral : undefined
      });
      this.isReplied = true;
      logger.debug("✅ 인터랙션 응답 유예");
    } catch (error) {
      logger.error("응답 유예 실패:", error);
    }
  }

  /**
   * 유예된 인터랙션 응답 수정
   * deferReply() 후 실제 응답 내용 전송
   * 
   * @param msg - 전송할 메시지 내용
   * @throws {Error} 응답 수정 중 오류 발생 시
   */
  async editReply(msg: string, force: boolean = false): Promise<void> {
    try {
      if (!this.interaction) return;
      if (this.interaction instanceof Message) return;
      if (!this.interaction.isChatInputCommand()) return;

      const server: DATA | null = await Servers.findOne({
        where: { id: this.interaction.guildId },
      });
      if (!server) {
        logger.serverNotRegistered();
        return;
      }

      if (server.dataValues.isMuted) return;

      await this.interaction.editReply({
        content: msg,
      });
      logger.debug("✅ 유예된 응답 수정 완료");
    } catch (error) {
      logger.error("응답 수정 실패:", error);
      // 편집 실패 시 일반 메시지로 대체 전송
      await this.send(msg);
    }
  }

  /**
   * 인터랙션 또는 메시지에 응답
   * 첫 응답인 경우 reply(), 이후에는 send() 사용
   * 
   * @param msg - 전송할 메시지 내용
   * @throws {Error} 응답 전송 중 오류 발생 시
   */
  async reply(msg: string): Promise<void> {
    try {
      if (!this.interaction) return;
      if (
        !(
          this.interaction instanceof Message ||
          this.interaction.isChatInputCommand()
        )
      )
        return;

      const server: DATA | null = await Servers.findOne({
        where: { id: this.interaction.guildId },
      });
      if (!server) {
        logger.serverNotRegistered();
        return;
      }

      if (this.isReplied) {
        if (server.dataValues.isMuted) return;
        await this.send(msg);
        return;
      }

      // 첫 응답 시도
      try {
        if (this.interaction instanceof ChatInputCommandInteraction) {
          await this.interaction.reply({
            content: msg,
            flags: server.dataValues.isMuted ? MessageFlags.Ephemeral : undefined,
          });
        } else if (!server.dataValues.isMuted) {
          await this.interaction.reply(msg);
        }
        this.isReplied = true;
      } catch (err) {
        // 권한 없음 오류 시 채널에 직접 전송 시도
        if (err instanceof DiscordAPIError && err.code === 50013) {
          logger.error("인터랙션 응답 권한 없음, 대체 전송 시도", err);
          // 메시지 참조 없이 채널에 직접 전송
          try {
            if (this.interaction.channel && !(this.interaction.channel instanceof PartialGroupDMChannel)) {
              await this.interaction.channel.send(msg);
              this.isReplied = true;
            } else {
              logger.error("대체 전송할 적절한 채널 없음");
            }
          } catch (sendErr) {
            logger.error("대체 전송도 실패:", sendErr);
          }
        } else {
          throw err;
        }
      }
    } catch (error) {
      logger.error("인터랙션 응답 실패:", error);
    }
  }

  /**
   * 음성 인식 및 STT 처리 (현재 비활성화)
   * Discord 음성을 인식하여 텍스트로 변환하는 기능
   */
  // listen() {
  // 	const opusEncoder = new OpusEncoder.OpusEncoder( 16000, 1 );

  // 	const userId = this.agent.member.user.id;
  // 	const guildId = this.agent.guildId;
  // 	const endBehavior = {
  // 		behavior: EndBehaviorType.AfterSilence,
  // 		duration: 100
  // 	};
  // 	const userName = this.agent.member.user.username;

  // 	// 100ms 동안 userId의 소리가 안날때까지 voiceConnection 유지
  // 	const audio = getVoiceConnection(guildId).receiver.subscribe(userId, { end: endBehavior });

  // 	console.log(`Played user: ${userName}`);
  // 	this.reply('듣는중...');

  // 	// 오디오 청크 저장
  // 	let sizeOfBuffer = 0;
  // 	let buffer = [];
  // 	audio.on('data', chunk => {
  // 		let decodedChunk = opusEncoder.decode(chunk);	// 청크 디코딩
  // 		sizeOfBuffer += decodedChunk.length;			// 버퍼 크기 수정
  // 		buffer.push(decodedChunk);						// 버퍼 저장
  // 	});

  // 	// 오디오 입력 종료
  // 	audio.on('end', async () => {
  // 		console.log(`Buffer Size: ${sizeOfBuffer}`);				// 버퍼 크기 출력
  // 		const mergedBuffer = Buffer.concat(buffer, sizeOfBuffer);	// 버퍼 병합
  // 		// console.log(mergedBuffer.toString('base64') + '\n');
  // 		// this.agent.reply('저장중');

  // 		try {
  // 			// STT엔진 호출, msg에 메세지 저장
  // 			const msg = await reqSTT(mergedBuffer);

  // 			// 메세지 파싱, 해당 명령 실행
  // 			switch(msg) {
  // 				// 날씨 이미지 API 호출
  // 				case '이미지':
  // 					this.send(await GetWeatherImage());
  // 					break;

  // 				// 음성 채널 나가기
  // 				case '나가':
  // 				case '나가.':
  // 				case '주희야 나가':
  // 					this.exitVoiceChannel();
  // 					break;

  // 				// 없는 명령어
  // 				default:
  // 					const tmp = blockQuote(msg);
  // 					this.reply(`${tmp}\n잘못들었습니다?`);
  // 					break;
  // 			}
  // 		} catch(e) {
  // 			console.log(e.toString());
  // 			this.reply(e.toString());
  // 			return;
  // 		}
  // 	});
  // }
}
