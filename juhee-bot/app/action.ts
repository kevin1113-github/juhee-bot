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
        
        // Handle connection events
        connection.on('error', (error) => {
          logger.reconnectionFailed(error);
        });
        
        await this.reply("음성 채널 접속 성공");
        logger.info(`🔊 Joined voice channel "${voiceChannel.name}" in guild ${this.interaction.guildId}`);
        return;
      } else {
        await this.reply("이미 접속 되어 있습니다");
        return;
      }
    } catch (error) {
      logger.error("Failed to join voice channel:", error);
      await this.reply("음성채널 접속 중 오류가 발생했습니다.");
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
