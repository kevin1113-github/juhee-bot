import dotenv from "dotenv";
dotenv.config();
const TOKEN: string = process.env.TOKEN ?? "";
const CLIENT_ID: string = process.env.CLIENT_ID ?? "";

import { __dirname } from "./const.js";
import { logger } from "./logger.js";

import {
  REST,
  Routes,
  Client,
  GatewayIntentBits,
  MessageType,
  Events,
  Interaction,
  GuildMember,
} from "discord.js";
import {
  getVoiceConnection,
  createAudioPlayer,
  NoSubscriberBehavior,
  createAudioResource,
  StreamType,
  AudioPlayer,
  AudioPlayerStatus,
  VoiceConnection,
} from "@discordjs/voice";
import Stream, { PassThrough } from "stream";

// custom import
import msTTS from "./msTTS.js";
import Commands from "./commands.js";
import { RegisterUser, RegisterUserMsg } from "./dbFunction.js";
import { JoinedServer, Servers, Users } from "./dbObject.js";
import Action from "./action.js";
import { DATA, GuildData } from "./types.js";
import HttpServer from "./api.js";
// import { AudioMixer } from "node-audio-mixer";

const guildDataList: GuildData[] = [];

// Global error handlers
process.on("unhandledRejection", (reason, promise) => {
  logger.unhandledRejection(reason);
});

process.on("uncaughtException", (error) => {
  logger.error("💥 Uncaught Exception:", error);
  process.exit(1);
});

// SIGINT handler for graceful shutdown
process.on("SIGINT", () => {
  logger.info("🛑 Received SIGINT, shutting down gracefully...");
  logger.cleanup();
  process.exit(0);
});

// Reloading (/) commands.
const rest = new REST({ version: "10" }).setToken(TOKEN);
try {
  logger.commandRefresh();
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: Commands });
  logger.commandRefreshSuccess();
} catch (error) {
  logger.error("Failed to load application commands:", error);
  process.exit(1);
}

// When bot is ready.
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});
let httpServer: HttpServer;
client.once(Events.ClientReady, async () => {
  try {
    // TODO: DB 불러오기
    logger.info("🔄 Initializing database...");
    await Servers.sync({ alter: true }); // 기존 테이블 구조 업데이트
    await Users.sync({ alter: true });
    await JoinedServer.sync({ alter: true });
    logger.info("✅ Database initialized successfully");

    const servers = await Servers.findAll();
    logger.info(`📊 Found ${servers.length} registered servers`);

    for (const server of servers) {
      guildDataList.push({
        guildId: server.dataValues.id,
        audioPlayer: null,
        // audioMixer: null,
        action: new Action(),
        timeOut: null,
      });
    }

    httpServer = new HttpServer(client);
    httpServer.start();
    logger.botReady(client.user?.tag || "Unknown");

    // // Clean up old logs
    // logger.cleanupOldLogs();
  } catch (error) {
    logger.error("Failed to initialize bot:", error);
    process.exit(1);
  }
});

// When bot received interaction.
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (!interaction.guildId) {
        await interaction.reply("서버에서 사용해주세요.");
        return;
      }

      // register user
      await RegisterUser(interaction);
      // get nickname
      const NICKNAME: string = getNickName(interaction);

      // get server data
      const server: DATA | null = await Servers.findOne({
        where: { id: interaction.guildId },
      });
      if (!server) {
        logger.serverNotRegistered();
        await interaction.reply(
          "서버가 등록되지 않았습니다. 잠시 후 다시 시도해주세요."
        );
        return;
      }

      // get guild data
      let guildData: GuildData | undefined = guildDataList.find(
        (data) => data.guildId == interaction.guildId
      );
      if (!guildData) {
        guildData = {
          guildId: interaction.guildId,
          audioPlayer: null,
          // audioMixer: null,
          action: new Action(interaction),
          timeOut: null,
        };
        guildDataList.push(guildData);
      } else {
        guildData.action.setInteraction(interaction);
      }

      // guildData가 undefined가 아닌 것을 보장
      if (!guildData) {
        await interaction.reply("서버 데이터를 가져올 수 없습니다.");
        return;
      }

      if (interaction.commandName === "들어와") {
        // 새로운 오디오 플레이어로 접속
        guildData.audioPlayer = createNewAudioPlayer();
        await guildData.action.joinVoiceChannel(guildData.audioPlayer);
      }

      if (interaction.commandName === "나가") {
        guildData.audioPlayer = null;
        await guildData.action.exitVoiceChannel();
      }

      if (interaction.commandName === "채널설정") {
        const channelId: string | undefined =
          interaction.options.getChannel("채널")?.id;
        if (!channelId) {
          await guildData.action.reply(`tts 채널이 설정되지 않았습니다.`);
          return;
        }

        await server.update({ ttsChannel: channelId });
        await guildData.action.reply(
          `[${
            (
              await interaction.guild?.channels.fetch(channelId)
            )?.name
          }] 채널이 tts 채널로 설정되었습니다.`
        );
      }

      if (interaction.commandName === "채널해제") {
        const channelId = server.dataValues.ttsChannel;
        if (!channelId) {
          await guildData.action.reply(`tts 채널이 설정되지 않았습니다.`);
          return;
        }

        await server.update({ ttsChannel: null });
        await guildData.action.reply(`tts 채널이 해제되었습니다.`);
      }

      if (interaction.commandName === "현재목소리") {
        const user: DATA | null = await Users.findOne({
          where: { id: interaction.user.id },
        });
        if (!user) {
          await guildData.action.reply(`유저가 등록되지 않았습니다.`);
          return;
        }

        const ttsVoice: string = user.dataValues.ttsVoice ?? "SeoHyeonNeural";
        const ttsName: string =
          [
            { name: "선히(여)", value: "SunHiNeural" },
            { name: "인준(남)", value: "InJoonNeural" },
            { name: "봉진(남)", value: "BongJinNeural" },
            { name: "국민(남)", value: "GookMinNeural" },
            // { name: '현수(남)', value: 'HyunsuNeural' },
            { name: "지민(여)", value: "JiMinNeural" },
            { name: "서현(여)", value: "SeoHyeonNeural" },
            { name: "순복(여)", value: "SoonBokNeural" },
            { name: "유진(여)", value: "YuJinNeural" },
          ].find((kv) => kv.value === ttsVoice)?.name ?? "선히(여)";

        await guildData.action.reply(`현재 tts 목소리: \`${ttsName}\``);
      }

      if (interaction.commandName === "목소리설정") {
        const voice: string =
          interaction.options.getString("목소리") ?? "SeoHyeonNeural";

        const user: DATA | null = await Users.findOne({
          where: { id: interaction.user.id },
        });
        if (!user) {
          await guildData.action.reply(`유저가 등록되지 않았습니다.`);
          return;
        }

        await user.update({ ttsVoice: voice });
        await guildData.action.reply(`목소리가 변경되었습니다.`);
      }

      if (interaction.commandName === "속도설정") {
        const speed: number = interaction.options.getInteger("속도값") ?? 0;

        const user: DATA | null = await Users.findOne({
          where: { id: interaction.user.id },
        });
        if (!user) {
          await guildData.action.reply(`유저가 등록되지 않았습니다.`);
          return;
        }

        await user.update({ speed: speed });
        await guildData.action.reply(`속도가 변경되었습니다.`);
      }

      if (interaction.commandName === "음소거") {
        await server.update({ isMuted: true });
        await guildData.action.reply(`음소거 되었습니다.`);
      }

      if (interaction.commandName === "음소거해제") {
        await server.update({ isMuted: false });
        await guildData.action.reply(`음소거 해제되었습니다.`);
      }

      // if (interaction.commandName === "동시재생") {
      //   const enabled: boolean =
      //     interaction.options.getBoolean("활성화") ?? false;
      //   await server.update({ simultaneousPlayback: enabled });

      //   if (enabled) {
      //     // 동시재생 활성화 시 오디오 믹서 초기화
      //     if (!guildData.audioMixer) {
      //       guildData.audioMixer = createNewAudioMixer();
      //     }
      //     await guildData.action.reply(
      //       `🎵 Node.js 기반 실시간 동시재생이 활성화되었습니다! 이제 여러 사람의 메시지가 동시에 믹싱되어 재생됩니다.`
      //     );
      //   } else {
      //     // 동시재생 비활성화 시 믹서 정리
      //     if (guildData.audioMixer) {
      //       guildData.audioMixer.destroy();
      //       guildData.audioMixer = null;
      //     }
      //     await guildData.action.reply(
      //       `🔄 동시재생이 비활성화되었습니다. 기존과 같이 순차적으로 TTS가 재생됩니다.`
      //     );
      //   }
      // }

      // if (interaction.commandName === "믹서상태") {
      //   const simultaneousPlayback = server.dataValues.simultaneousPlayback;

      //   if (guildData.audioMixer) {
      //     const mixer = guildData.audioMixer;
      //     await guildData.action.reply(
      //       `**🎛️ 오디오 믹서 상태**\n` +
      //         `• 동시재생 모드: ✅ 활성화\n` +
      //         // `• 현재 입력 수: ${mixer.inputs.size}개\n` +
      //         // `• 믹서 상태: ${
      //         //   mixer. ? "🎵 실행 중" : "⏸️ 대기 중"
      //         // }\n` +
      //         // `• 최대 입력: ${status.maxInputs}개\n` +
      //         `• 오디오 플레이어: ${
      //           guildData.audioPlayer ? "연결됨" : "연결 안됨"
      //         }\n`
      //       // }\n` +
      //       // `• 활성 입력: ${
      //       //   status.activeInputs
      //       //     .map(
      //       //       (t: { userId: string; voice: string }) =>
      //       //         `${t.userId}(${t.voice})`
      //       //     )
      //       //     .join(", ") || "없음"
      //       // }`
      //     );
      //   } else {
      //     await guildData.action.reply(
      //       `**🎛️ 오디오 믹서 상태**\n` +
      //         `• 동시재생 모드: ${
      //           simultaneousPlayback ? "✅ 활성화" : "❌ 비활성화"
      //         }\n` +
      //         `• 믹서 상태: 비활성\n` +
      //         `• 오디오 플레이어: ${
      //           guildData.audioPlayer ? "연결됨" : "연결 안됨"
      //         }`
      //     );
      //   }
      // }

      // 슬래시 커맨드 사용시 아무 응답을 하지 않았을 경우 오류 응답 처리
      if (!guildData.action.isReplied) {
        await guildData.action.reply(
          `예기치 못한 오류 발생. 개발자에게 문의해주세요.`
        );
        return;
      }
    }
  } catch (error) {
    logger.error("Error handling interaction:", error);
    try {
      if (interaction.isChatInputCommand() && !interaction.replied) {
        await interaction.reply({
          content: "오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
          ephemeral: true,
        });
      }
    } catch (replyError) {
      logger.error("Failed to send error reply:", replyError);
    }
  }
});

client.on(Events.MessageCreate, async (message) => {
  try {
    // 봇이 보낸 메세지 또는 텍스트 메세지가 아니면 반응 안함.
    if (
      message.author.bot ||
      !(
        message.type == MessageType.Default || message.type == MessageType.Reply
      ) ||
      !message.inGuild() ||
      !message.member
    ) {
      return;
    }

    // get guild data
    let guildData: GuildData | undefined = guildDataList.find(
      (data) => data.guildId == message.guildId
    );
    if (!guildData) {
      guildData = {
        guildId: message.guildId,
        audioPlayer: null,
        // audioMixer: null,
        action: new Action(message),
        timeOut: null,
      };
      guildDataList.push(guildData);
    } else {
      guildData.action.setInteraction(message);
    }

    // guildData가 undefined가 아닌 것을 보장
    if (!guildData) {
      logger.error("Failed to create guild data for message");
      return;
    }

    // get server data
    const server: DATA | null = await Servers.findOne({
      where: { id: message.guildId },
    });
    if (!server) return;

    const ttsChannel: string | null = server.dataValues.ttsChannel;
    if (!ttsChannel) return;

    if (
      message.channelId == ttsChannel &&
      (message.member.voice.channelId ==
        getVoiceConnection(message.guildId)?.joinConfig.channelId ||
        !getVoiceConnection(message.guildId))
    ) {
      await RegisterUserMsg(message);

      const user: DATA | null = await Users.findOne({
        where: { id: message.author.id },
      });
      if (!user) return;

      // 동시재생 모드 확인
      // const simultaneousPlayback = server.dataValues.simultaneousPlayback;

      // if (simultaneousPlayback) {
      //   // 실시간 믹싱 기반 동시재생 모드
      //   logger.debug("🎛️ Using real-time mixing simultaneous playback mode");

      //   // 오디오 플레이어가 없으면 생성
      //   if (!guildData.audioPlayer) {
      //     guildData.audioPlayer = createNewAudioPlayer();
      //   }

      //   if (!getVoiceConnection(message.guildId)) {
      //     await guildData.action.joinVoiceChannel(guildData.audioPlayer);
      //   }

      //   try {
      //     const voiceName = user.dataValues.ttsVoice || "SeoHyeonNeural";

      //     await msTTS(
      //       parseMessage(message.content),
      //       (stream: PassThrough) => {
      //         // 오디오 플레이어가 없으면 생성
      //         if (!guildData.audioPlayer) {
      //           guildData.audioPlayer = createNewAudioPlayer();
      //         }

      //         // 오디오 믹서가 없으면 생성
      //         if (!guildData.audioMixer) {
      //           guildData.audioMixer = createNewAudioMixer();
      //           const audioStreamResource = createNewAudioResource(
      //             guildData.audioMixer
      //           );
      //           guildData.audioPlayer.play(audioStreamResource);
      //           logger.debug(
      //             `🎛️ Started/resumed master PCM mixing stream for guild`
      //           );
      //         } else {
      //           logger.debug(
      //             `🎛️ Audio Player status: ${guildData.audioPlayer.state.status}`
      //           );
      //           if (guildData.audioPlayer.state.status == AudioPlayerStatus.Idle) {
      //             guildData.audioPlayer.play(
      //               createNewAudioResource(guildData.audioMixer)
      //             );
      //           }
      //           logger.debug(
      //             `🎛️ Master PCM mixing stream already exsist, ${JSON.stringify(
      //               guildData.audioMixer
      //             )}`
      //           );
      //         }

      //         // 오디오 믹서에 입력 추가 (실시간 믹싱됨)
      //         const audioInput = createNewAudioInput(guildData.audioMixer);
      //         // audioInput.
      //         stream.pipe(audioInput);
      //         logger.debug(
      //           `🎛️ Audio Player status: ${guildData.audioPlayer.state.status}`
      //         );
      //         // setTimeout(() => {
      //         //   logger.debug(
      //         //     `🎛️ Audio Player status: ${guildData.audioPlayer?.state.status}`
      //         //   );
      //         // }, 500);

      //         logger.debug(
      //           `🎛️ Added to real-time mix: ${message.author.username} (${voiceName})`
      //         );
      //       },
      //       voiceName,
      //       user.dataValues.speed
      //     );
      //   } catch (e) {
      //     logger.error("Real-time TTS mixing failed:", e);
      //     await guildData.action.reply(
      //       "실시간 TTS 믹싱 중 오류가 발생했습니다."
      //     );
      //   }
      // } else {
      // 기존 순차 재생 모드
      // logger.debug("🔄 Using sequential playback mode");

      if (
        guildData.audioPlayer &&
        guildData.audioPlayer.state.status == AudioPlayerStatus.Playing
      ) {
        await guildData.action.reply("이미 tts가 재생중입니다.");
        return;
      }

      if (!guildData.audioPlayer) {
        guildData.audioPlayer = createNewAudioPlayer();
      }

      if (!getVoiceConnection(message.guildId)) {
        await guildData.action.joinVoiceChannel(guildData.audioPlayer);
      }

      try {
        await msTTS(
          parseMessage(message.content),
          (stream: PassThrough) => {
            const resource = createNewOggOpusAudioResource(stream);
            guildData.audioPlayer?.play(resource);
          },
          user.dataValues.ttsVoice,
          user.dataValues.speed
        );
      } catch (e) {
        logger.error("TTS generation failed:", e);
        await guildData.action.reply("TTS 생성 중 오류가 발생했습니다.");
      }
      // }

      if (guildData.timeOut) {
        clearTimeout(guildData.timeOut);
      }

      const timeOut: NodeJS.Timeout = setTimeout(async () => {
        try {
          if (!getVoiceConnection(message.guildId)) return;
          if (guildData) {
            guildData.audioPlayer?.stop();
            guildData.audioPlayer = null;
            getVoiceConnection(message.guildId)?.destroy();
            await guildData?.action.send("tts가 종료되었습니다.");
            logger.info("TTS session timed out and disconnected");
          }
        } catch (error) {
          logger.error("Error during TTS timeout cleanup:", error);
        }
      }, 1800_000);
      guildData.timeOut = timeOut;
    }
  } catch (error) {
    logger.error("Error handling message:", error);
  }
});

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  try {
    if (!oldState.guild) {
      return;
    }
    const connection: VoiceConnection | undefined = getVoiceConnection(
      oldState.guild.id
    );
    if (!connection) {
      return;
    }

    // 사용자가 음성 채널을 떠났을 때
    if (oldState.channelId && !newState.channelId) {
      const channel = oldState.channel;
      if (!channel || channel.id != connection.joinConfig.channelId) {
        return;
      }

      if (channel) {
        const nonBotMembers = channel.members.filter(
          (member) => !member.user.bot
        );

        // 음성 채널에 남은 사람이 없는지 확인
        if (nonBotMembers.size === 0) {
          // 음성 채널에서 봇을 나가게 합니다.
          connection.destroy();
          const guildData: GuildData | undefined = guildDataList.find(
            (data) => data.guildId == oldState.guild.id
          );
          if (!guildData) {
            return;
          }
          guildData.audioPlayer = null;

          // // 오디오 믹서도 정리
          // if (guildData.audioMixer) {
          //   guildData.audioMixer.destroy();
          //   guildData.audioMixer = null;
          // }

          logger.info("Bot left empty voice channel");
        }
      }
    }
  } catch (error) {
    logger.error("Error handling voice state update:", error);
  }
});

client.login(TOKEN);

// function parseMessage(messageContent: string): string {
//   // URL 제거
//   const urlRegex = /(https?:\/\/[^\s]+)/g;
//   let cleanMessage = messageContent.replace(urlRegex, "링크");

//   return cleanMessage;
// }

function parseMessage(messageContent: string): string {
  messageContent = messageContent.substring(0, 200);

  if (messageContent == "ㅋㅋ") return "크크";
  else if (messageContent == "ㅋㅋㅋ") return "크크크";
  else if (messageContent == "ㅎㅇ") return "하이";
  else if (messageContent == "ㅂㅇ") return "바이";
  else if (messageContent == "ㅃㅇ") return "빠이";
  else if (messageContent == "ㅃㅃ") return "빠빠";
  else if (messageContent == "ㄷㄷ") return "덜덜";
  else if (messageContent == "ㄹㅇ") return "레알";
  else if (messageContent == "ㅇㅋ") return "오키";

  const mentionReg = new RegExp(/<@([0-9]{3,})>/, "g");
  const roleReg = new RegExp(/<@&([0-9]{3,})>/, "g");
  const channelReg = new RegExp(/<#([0-9]{3,})>/, "g");
  const urlReg = new RegExp(/http[s]?:\/\/([\S]{3,})/, "g");

  const wisperReg = new RegExp(/\([^)]+\)/);
  const lolReg = new RegExp(/(ㅋ{3,})/, "g");
  const dotReg = new RegExp(/(\.{2,})/, "g");

  messageContent = messageContent.replace(mentionReg, " 멘션 ");
  messageContent = messageContent.replace(roleReg, " 역할 ");
  messageContent = messageContent.replace(channelReg, " 채널 ");
  messageContent = messageContent.replace(urlReg, " 링크 ");
  messageContent = messageContent.replace(wisperReg, " ");
  messageContent = messageContent.replace(lolReg, " 크크크 ");
  messageContent = messageContent.replace(dotReg, " ");

  const gtReg = /[>]/gi;
  const ltReg = /[<]/gi;
  const ampReg = /[&]/gi;
  const quoteReg = /["]/gi;
  const aposReg = /[']/gi;

  messageContent = messageContent.replace(gtReg, "&gt;");
  messageContent = messageContent.replace(ltReg, "&lt;");
  messageContent = messageContent.replace(ampReg, "&amp;");
  messageContent = messageContent.replace(quoteReg, "&quot;");
  messageContent = messageContent.replace(aposReg, "&apos;");

  return messageContent;
}

function getNickName(interaction: Interaction): string {
  if (interaction.member instanceof GuildMember) {
    return interaction.member.displayName;
  }
  if ("user" in interaction) {
    return interaction.user.username;
  }
  return "Unknown";
}

function createNewAudioPlayer() {
  return createAudioPlayer({
    behaviors: {
      noSubscriber: NoSubscriberBehavior.Pause,
    },
  });
}

function createNewOggOpusAudioResource(
  stream: Stream.Readable,
  inputType: StreamType | undefined = undefined
) {
  const resource = createAudioResource(stream, {
    inputType: inputType ?? StreamType.OggOpus,
    silencePaddingFrames: 0,
  });
  return resource;
}

// function createNewAudioResource(
//   stream: Stream.Readable,
//   inputType: StreamType | undefined = undefined
// ) {
//   const resource = createAudioResource(stream, {
//     inputType: inputType ?? StreamType.Raw,
//     silencePaddingFrames: 0,
//   });
//   // resource.encoder?.setBitrate(768000);
//   return resource;
// }

// function createNewAudioMixer() {
//   return new AudioMixer({
//     sampleRate: 48000,
//     bitDepth: 16,
//     channels: 1,
//     generateSilence: true,
//     autoClose: false,
//   });
// }

// function createNewAudioInput(mixer: AudioMixer) {
//   const input = mixer.createAudioInput({
//     sampleRate: 48000,
//     bitDepth: 16,
//     channels: 1,
//     forceClose: false,
//   });

//   input.on("end", () => {
//     mixer.removeAudioinput(input);
//     logger.debug("🎛️ Audio Input ended");
//   });

//   return input;
// }
