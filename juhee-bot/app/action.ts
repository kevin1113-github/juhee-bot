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

export default class Action {
  interaction: Interaction | Message | null;
  isReplied = false;

  constructor(interaction: Interaction | Message | null = null) {
    this.interaction = interaction;
    this.isReplied = false;
  }

  // 메세지나 슬래시 커맨드 입력시
  setInteraction(interaction: Interaction | Message) {
    this.interaction = interaction;
    this.isReplied = false;
  }

  async exitVoiceChannel() {
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
        await this.reply("음성채널 나감");
        logger.info(`🚪 Left voice channel in guild ${this.interaction.guildId}`);
        return;
      }
    } catch (error) {
      logger.error("Failed to exit voice channel:", error);
      await this.reply("음성채널 나가기 중 오류가 발생했습니다.");
    }
  }

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
        
        // 음성 연결 상태 관리 및 재연결 로직
        this.setupVoiceConnectionHandlers(connection, voiceChannel, audioPlayer);
        
        await this.reply("음성 채널 접속 성공");
        logger.info(`🔊 Joined voice channel "${voiceChannel.name}" in guild ${this.interaction.guildId}`);
        return;
      } else {
        // 기존 연결이 있지만 핸들러가 설정되지 않았을 수도 있으므로 설정
        this.setupVoiceConnectionHandlers(voiceConnection, voiceChannel, audioPlayer);
        await this.reply("이미 접속 되어 있습니다");
        return;
      }
    } catch (error) {
      logger.error("Failed to join voice channel:", error);
      await this.reply("음성채널 접속 중 오류가 발생했습니다.");
    }
  }

  private setupVoiceConnectionHandlers(
    connection: VoiceConnection, 
    voiceChannel: VoiceBasedChannel, 
    audioPlayer: AudioPlayer,
    retryCount: number = 0
  ) {
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 5000; // 5초
    
    // 연결 상태 변화 처리
    connection.on(VoiceConnectionStatus.Disconnected, async (oldState, newState) => {
      try {
        logger.warn(`🔌 Voice connection disconnected in guild ${voiceChannel.guild.id}`);
        
        // 재연결 시도 (최대 5초 대기)
        await Promise.race([
          connection.configureNetworking(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('ETIMEDOUT')), 5000)
          )
        ]);
        
        logger.info(`🔌 Voice connection restored in guild ${voiceChannel.guild.id}`);
      } catch (error) {
        logger.error(`🔌 Voice connection lost, attempting reconnection... (${retryCount + 1}/${MAX_RETRIES})`);
        
        if (retryCount < MAX_RETRIES) {
          // 재연결 시도
          setTimeout(() => {
            this.reconnectVoiceChannel(voiceChannel, audioPlayer, retryCount + 1);
          }, RETRY_DELAY);
        } else {
          logger.reconnectionFailed(error);
          connection.destroy();
        }
      }
    });

    // 준비 상태
    connection.on(VoiceConnectionStatus.Ready, () => {
      logger.info(`🔌 Voice connection ready in guild ${voiceChannel.guild.id}`);
    });

    // 일반적인 에러 처리
    connection.on('error', (error) => {
      logger.error(`🔌 Voice connection error in guild ${voiceChannel.guild.id}:`, error);
      
      // 타임아웃 에러의 경우 재연결 시도
      if (error.message?.includes('ETIMEDOUT') && retryCount < MAX_RETRIES) {
        logger.warn(`🔌 Timeout error, attempting reconnection... (${retryCount + 1}/${MAX_RETRIES})`);
        setTimeout(() => {
          this.reconnectVoiceChannel(voiceChannel, audioPlayer, retryCount + 1);
        }, RETRY_DELAY);
      } else {
        logger.reconnectionFailed(error);
      }
    });

    // 네트워크 상태 변화 감지
    connection.on('stateChange', (oldState, newState) => {
      logger.debug(`🔌 Voice connection state changed: ${oldState.status} -> ${newState.status}`);
    });
  }

  private async reconnectVoiceChannel(
    voiceChannel: VoiceBasedChannel, 
    audioPlayer: AudioPlayer, 
    retryCount: number = 0
  ) {
    try {
      logger.info(`🔌 Attempting to reconnect to voice channel "${voiceChannel.name}" (attempt ${retryCount})`);
      
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
      
      logger.info(`🔌 Successfully reconnected to voice channel "${voiceChannel.name}"`);
    } catch (error) {
      logger.error(`🔌 Failed to reconnect to voice channel (attempt ${retryCount}):`, error);
      
      // 최대 재시도 횟수에 도달하지 않았다면 다시 시도
      if (retryCount < 3) {
        setTimeout(() => {
          this.reconnectVoiceChannel(voiceChannel, audioPlayer, retryCount + 1);
        }, 5000 * retryCount); // 점진적으로 대기 시간 증가
      }
    }
  }

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
        // If bot lacks SEND_MESSAGES in the channel (50013), log and skip
        if (err instanceof DiscordAPIError && err.code === 50013) {
          logger.error("Missing permission to send message in channel", err);
          return;
        }
        throw err;
      }
    } catch (error) {
      logger.error("Failed to send message:", error);
    }
  }

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

      // first reply attempt
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
        // If Missing Permissions when replying (for example replying with message reference),
        // try a safer fallback: send directly to the channel (if available and allowed).
        if (err instanceof DiscordAPIError && err.code === 50013) {
          logger.error("Missing permission to reply to interaction, attempting fallback send", err);
          // Fallback to channel send without message reference / ephemeral flags
          try {
            if (this.interaction.channel && !(this.interaction.channel instanceof PartialGroupDMChannel)) {
              await this.interaction.channel.send(msg);
              this.isReplied = true;
            } else {
              logger.error("No suitable channel to fallback-send reply");
            }
          } catch (sendErr) {
            logger.error("Fallback send also failed:", sendErr);
          }
        } else {
          throw err;
        }
      }
    } catch (error) {
      logger.error("Failed to reply to interaction:", error);
    }
  }

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
