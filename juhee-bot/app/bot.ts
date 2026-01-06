/**
 * @fileoverview 주희봇 Discord TTS 봇 메인 파일
 * @description Discord 서버에서 텍스트를 음성으로 변환하여 음성 채널에서 재생하는 봇
 * @author kevin1113dev
 * @version 1.0.0
 */

import dotenv from "dotenv";
dotenv.config();

/** Discord 봇 토큰 */
const TOKEN: string = process.env.TOKEN ?? "";
const TTS_LIMIT: number = parseInt(process.env.TTS_LIMIT ?? "200", 10);
const SHARDS: string = process.env.SHARDS ?? "";

if (!TOKEN || !SHARDS) {
  console.error(
    "❌ 필수 환경 변수가 설정되지 않았습니다. .env 파일을 확인하세요."
  );
  process.exit(1);
}

import { __dirname } from "./const.js";
import { logger } from "./logger.js";

import {
  Client,
  GatewayIntentBits,
  MessageType,
  Events,
  Interaction,
  GuildMember,
  MessageFlags,
  Collection,
  Guild,
} from "discord.js";
import {
  getVoiceConnection,
  createAudioPlayer,
  NoSubscriberBehavior,
  createAudioResource,
  StreamType,
  AudioPlayerStatus,
  VoiceConnection,
} from "@discordjs/voice";
import Stream, { PassThrough } from "stream";

import msTTS from "./msTTS.js";
import { RegisterUser, RegisterUserMsg } from "./dbFunction.js";
import { JoinedServer, Servers, Users } from "./dbObject.js";
import Action from "./action.js";
import { DATA, GuildData } from "./types.js";
import HttpServer from "./api.js";

/**
 * 각 서버(길드)의 오디오 플레이어, 액션, 타임아웃을 관리하는 전역 배열
 * @type {GuildData[]}
 */
const guildDataList: GuildData[] = [];

/**
 * 전역 에러 핸들러
 * 처리되지 않은 Promise 거부와 예외를 잡아서 로그를 남김
 */
process.on("unhandledRejection", (reason, promise) => {
  logger.unhandledRejection(reason);
  // 상세 스택 트레이스 로깅
  if (reason instanceof Error) {
    logger.error("💥 Unhandled Rejection Stack:", reason.stack);
  }
  // 치명적인 에러로 간주하고 프로세스 종료 (nodemon이 재시작)
  logger.error("⚠️ 처리되지 않은 Promise rejection으로 인해 프로세스 종료");
  process.exit(1);
});

process.on("uncaughtException", (error) => {
  logger.error("💥 처리되지 않은 예외:", error);
  logger.error("💥 Exception Stack:", error.stack);
  process.exit(1);
});

/**
 * SIGINT 시그널 핸들러 - 정상적인 종료 처리
 */
process.on("SIGINT", () => {
  logger.info(`🛑 SIGINT 신호 수신, ${SHARDS}번 샤드 정상 종료 중...`);
  logger.cleanup();
  process.exit(0);
});

/**
 * Discord 클라이언트 인스턴스 생성
 * 필요한 Intent(권한)를 설정하여 봇이 서버, 음성 상태, 메시지를 처리할 수 있도록 함
 *
 * @remarks
 * 샤딩을 사용하는 경우 각 샤드가 별도의 클라이언트 인스턴스를 가짐
 */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

let httpServer: HttpServer;

/**
 * 봇이 준비되었을 때 실행되는 이벤트 핸들러
 * 데이터베이스 초기화, 서버 정리, HTTP 서버 시작 등을 처리
 */
client.once(Events.ClientReady, async () => {
  try {
    if (!client.shard) {
      logger.error("ℹ️ 샤딩이 활성화되지 않았습니다.");
      process.exit(1);
    }

    // 샤드 정보 로깅
    const shardInfo = `샤드 #${client.shard.ids[0]} / ${client.shard.count}`;

    logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    logger.info(`🔷 ${shardInfo}`);
    logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    logger.info("🔄 데이터베이스 초기화 중...");
    // alter: true는 데이터 손실 위험이 있으므로 제거
    // 프로덕션에서는 마이그레이션을 사용하거나 force: false로 안전하게 처리
    await Servers.sync(); // 테이블이 없으면 생성, 있으면 유지
    await Users.sync();
    await JoinedServer.sync();
    logger.info("✅ 데이터베이스 초기화 완료");

    const servers = await Servers.findAll();
    logger.info(`📊 데이터베이스에서 ${servers.length}개 서버 발견`);

    // 현재 샤드가 실제로 접속한 서버 목록 가져오기
    const actualGuilds = client.guilds.cache;
    // logger.info(`🔗 현재 ${actualGuilds.size}개 서버에 접속 중`);
    logger.info(`🔗 이 샤드가 접속한 총 서버 ID 수: ${actualGuilds.size}개`);

    const results: Collection<string, Guild>[] =
      (await client.shard.fetchClientValues("guilds.cache")) as Collection<
        string,
        Guild
      >[];
    // logger.info("📡 모든 샤드에서 서버 목록을 가져옴", results);
    // const totalGuildIds: Collection<string, Guild> = new Collection();
    // for (const guilds of results) {
    //   guilds.forEach((guild, id) => {
    //     totalGuildIds.set(id, guild);
    //   });
    // }

    const totalGuilds: Collection<string, Guild> = results.reduce(
      (acc, guilds) => {
        guilds.forEach((guild, id) => {
          acc.set(id, guild);
        });
        return acc;
      },
      new Collection<string, Guild>()
    );

    const totalGuildIds: string[] = Array.from(totalGuilds.values()).map(
      (guild) => guild.id
    );

    // logger.info("📡 모든 샤드에서 서버 ID 수집 완료", totalGuildIds);
    logger.info(`🔗 봇이 접속한 전체 서버 ID 수: ${totalGuildIds.length}개`);

    // DB에 있지만 실제로 접속하지 않은 서버 찾기
    const serversToRemove: string[] = [];
    for (const server of servers) {
      const serverId: string = server.dataValues.id;
      if (!totalGuildIds.includes(serverId)) {
        serversToRemove.push(serverId);
        logger.warn(
          `⚠️ 서버 ID ${serverId}가 DB에 있지만 접속되지 않음 - 정리 예정`
        );
      }
    }

    // 접속하지 않은 서버 정리
    if (serversToRemove.length > 0) {
      logger.info(
        `🧹 ${serversToRemove.length}개 연결 해제된 서버를 정리하는 중...`
      );

      for (const serverId of serversToRemove) {
        try {
          // JoinedServer 테이블에서 해당 서버 관련 데이터 삭제
          const deletedJoins = await JoinedServer.destroy({
            where: { server_id: serverId },
          });

          // Servers 테이블에서 서버 삭제
          const deletedServer = await Servers.destroy({
            where: { id: serverId },
          });

          if (deletedServer > 0) {
            logger.info(
              `✅ 서버 ID ${serverId} 제거 완료 (${deletedJoins}개 사용자 관계 삭제)`
            );
          }
        } catch (error) {
          logger.error(`❌ 서버 ID ${serverId} 제거 실패:`, error);
        }
      }

      logger.info(
        `✅ 데이터베이스 정리 완료 (${serversToRemove.length}개 서버 제거)`
      );
    } else {
      logger.info(`✅ 모든 DB 서버가 현재 접속 중 - 정리 불필요`);
    }

    // 실제로 접속한 서버만 guildDataList에 추가
    const remainingServers = servers.filter((server) => {
      return actualGuilds.has(server.dataValues.id);
    });
    for (const server of remainingServers) {
      guildDataList.push({
        guildId: server.dataValues.id,
        audioPlayer: null,
        action: new Action(),
        timeOut: null,
      });
    }

    logger.info(`📋 ${guildDataList.length}개 활성 서버를 메모리에 로드 완료`);

    // 최종 통계 로깅
    const finalServerCount = await Servers.count();
    const finalUserCount = await Users.count();
    const finalJoinCount = await JoinedServer.count();

    logger.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    logger.info(`📊 데이터베이스 통계 (${shardInfo}):`);
    logger.info(`   🏢 이 샤드의 서버: ${actualGuilds.size}개`);
    logger.info(`   💾 등록된 서버: ${finalServerCount}개`);
    logger.info(`   👥 등록된 사용자: ${finalUserCount}명`);
    logger.info(`   🔗 서버-사용자 관계: ${finalJoinCount}개`);
    logger.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    // HTTP 서버는 샤드 #0에서만 시작 (중복 방지)
    if (client.shard.ids[0] === 0) {
      httpServer = new HttpServer(client);
      httpServer.start();
      logger.info("🌐 HTTP 서버 시작 (샤드 #0)");
    } else {
      logger.info(
        `ℹ️ HTTP 서버는 샤드 #0에서 실행됩니다 (현재: 샤드 #${client.shard.ids[0]})`
      );
    }

    const botTag = client.user?.tag || "Unknown";
    logger.botReady(botTag);
    logger.info(`🔷 샤드 정보: ${shardInfo}`);
  } catch (error) {
    logger.error("봇 초기화 실패:", error);
    process.exit(1);
  }
});

/**
 * 인터랙션(슬래시 커맨드) 처리 이벤트 핸들러
 * 사용자가 슬래시 커맨드를 입력했을 때 실행
 *
 * 지원하는 커맨드:
 * - /들어와: 음성 채널에 참가
 * - /나가: 음성 채널에서 나감
 * - /채널설정: TTS 채널 설정
 * - /채널해제: TTS 채널 해제
 * - /현재목소리: 현재 설정된 TTS 목소리 확인
 * - /목소리설정: TTS 목소리 변경
 * - /속도설정: TTS 속도 변경
 * - /음소거: 봇 음소거
 * - /음소거해제: 봇 음소거 해제
 */
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (!interaction.guildId) {
        await interaction.reply("서버에서 사용해주세요.");
        return;
      }

      // 사용자 등록
      await RegisterUser(interaction);

      // 닉네임 가져오기
      // const NICKNAME: string = getNickName(interaction);

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

      const isEmpheral: boolean = server.dataValues.isMuted ?? false;

      // 음성 채널 참가 명령
      if (interaction.commandName === "들어와") {
        guildData.audioPlayer = createNewAudioPlayer();
        await guildData.action.joinVoiceChannel(guildData.audioPlayer);
      }

      // 음성 채널 나가기 명령
      if (interaction.commandName === "나가") {
        await guildData.action.exitVoiceChannel(guildData);
      }

      // TTS 채널 설정 명령
      if (interaction.commandName === "채널설정") {
        await guildData.action.deferReply(isEmpheral);

        const channelId: string | undefined =
          interaction.options.getChannel("채널")?.id;
        if (!channelId) {
          await guildData.action.ttsChannelNotSet();
          return;
        }

        await server.update({ ttsChannel: channelId });
        await guildData.action.editReply(
          `[${
            (
              await interaction.guild?.channels.fetch(channelId)
            )?.name
          }] 채널이 tts 채널로 설정되었습니다.`
        );
      }

      // TTS 채널 해제 명령
      if (interaction.commandName === "채널해제") {
        await guildData.action.deferReply(isEmpheral);

        const channelId = server.dataValues.ttsChannel;
        if (!channelId) {
          await guildData.action.ttsChannelNotSet();
          return;
        }

        await server.update({ ttsChannel: null });
        await guildData.action.editReply(`tts 채널이 해제되었습니다.`);
      }

      // 현재 설정된 목소리 확인 명령
      if (interaction.commandName === "현재목소리") {
        await guildData.action.deferReply(isEmpheral);

        const user: DATA | null = await Users.findOne({
          where: { id: interaction.user.id },
        });
        if (!user) {
          await guildData.action.userNotRegistered();
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

        await guildData.action.editReply(`현재 tts 목소리: \`${ttsName}\``);
      }

      // 목소리 설정 명령
      if (interaction.commandName === "목소리설정") {
        await guildData.action.deferReply(isEmpheral);

        const voice: string =
          interaction.options.getString("목소리") ?? "SeoHyeonNeural";

        const user: DATA | null = await Users.findOne({
          where: { id: interaction.user.id },
        });
        if (!user) {
          await guildData.action.userNotRegistered();
          return;
        }

        await user.update({ ttsVoice: voice });
        await guildData.action.editReply(`목소리가 변경되었습니다.`);
      }

      // TTS 속도 설정 명령
      if (interaction.commandName === "속도설정") {
        await guildData.action.deferReply(isEmpheral);

        const speed: number = interaction.options.getInteger("속도값") ?? 0;

        const user: DATA | null = await Users.findOne({
          where: { id: interaction.user.id },
        });
        if (!user) {
          await guildData.action.userNotRegistered();
          return;
        }

        await user.update({ speed: speed });
        await guildData.action.editReply(`속도가 변경되었습니다.`);
      }

      // 현재 설정된 속도 확인 명령
      if (interaction.commandName === "현재속도") {
        await guildData.action.deferReply(isEmpheral);

        const user: DATA | null = await Users.findOne({
          where: { id: interaction.user.id },
        });
        if (!user) {
          await guildData.action.userNotRegistered();
          return;
        }

        const speed: number = user.dataValues.speed ?? 30;
        await guildData.action.editReply(`현재 tts 속도: \`${speed}\``);
      }

      // 음소거 명령
      if (interaction.commandName === "음소거") {
        await guildData.action.deferReply(true);
        await server.update({ isMuted: true });
        // 필요없음
        await guildData.action.editReply(`음소거되었습니다.`);
      }

      // 음소거 해제 명령
      if (interaction.commandName === "음소거해제") {
        await guildData.action.deferReply(false);
        await server.update({ isMuted: false });
        await guildData.action.editReply(`음소거 해제되었습니다.`);
      }

      // 응답하지 않은 경우 오류 메시지 전송
      if (!guildData.action.isReplied) {
        await guildData.action.reply(
          `예기치 못한 오류 발생. 개발자에게 문의해주세요.`
        );
        return;
      }
    }
  } catch (error) {
    logger.error("인터랙션 처리 오류:", error);
    try {
      if (interaction.isChatInputCommand() && !interaction.replied) {
        await interaction.reply({
          content: "오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (replyError) {
      logger.error("오류 응답 전송 실패:", replyError);
    }
  }
});

/**
 * 메시지 생성 이벤트 핸들러
 * TTS 채널에서 메시지가 생성될 때 텍스트를 음성으로 변환하여 재생
 *
 * @remarks
 * - 봇이 보낸 메시지는 무시
 * - 설정된 TTS 채널의 메시지만 처리
 * - 사용자가 음성 채널에 있을 때만 처리
 * - 30분 후 자동으로 음성 채널에서 나감
 */
client.on(Events.MessageCreate, async (message) => {
  try {
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

    // 길드 데이터 가져오기 또는 생성
    let guildData: GuildData | undefined = guildDataList.find(
      (data) => data.guildId == message.guildId
    );
    if (!guildData) {
      guildData = {
        guildId: message.guildId,
        audioPlayer: null,
        action: new Action(message),
        timeOut: null,
      };
      guildDataList.push(guildData);
    } else {
      guildData.action.setInteraction(message);
    }

    // guildData가 undefined가 아닌 것을 보장
    if (!guildData) {
      logger.error("메시지에 대한 길드 데이터 생성 실패");
      return;
    }

    // 서버 데이터 가져오기
    const server: DATA | null = await Servers.findOne({
      where: { id: message.guildId },
    });
    if (!server) return;

    const ttsChannel: string | null = server.dataValues.ttsChannel;
    if (!ttsChannel) return;

    // TTS 채널이고 사용자가 같은 음성 채널에 있는지 확인
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
        const joined = await guildData.action.joinVoiceChannel(
          guildData.audioPlayer
        );
        if (!joined) {
          return;
        }
      }

      const originalText = message.content;
      if (message.content.length > TTS_LIMIT) {
        await guildData.action.reply(
          `메시지가 너무 깁니다. ${TTS_LIMIT}자에서 재생이 제한됩니다.`
        );
      }
      const parsedText = parseMessage(message.content);
      const voiceName = user.dataValues.ttsVoice;
      const speed = user.dataValues.speed;
      const displayName =
        message.member?.displayName || message.author.username;

      try {
        await msTTS(
          parsedText,
          (stream: PassThrough | null) => {
            if (!stream) {
              logger.warn(
                `⚠️ TTS 실패: [${message.guild.name}] ${displayName} | "${parsedText}"`
              );
              guildData?.action.send(
                "TTS 생성에 실패했습니다. 잠시 후 다시 시도해주세요."
              );
              return;
            }

            // guildData 및 audioPlayer null 체크 강화
            if (!guildData) {
              logger.warn(`⚠️ GuildData 없음: ${message.guild.name}`);
              return;
            }

            if (!guildData.audioPlayer) {
              logger.warn(`⚠️ 오디오 플레이어 없음: ${message.guild.name}`);
              return;
            }

            try {
              const resource = createNewOggOpusAudioResource(stream);
              guildData.audioPlayer.play(resource);
              logger.info(
                `🎵 TTS: [${message.guild.name}] ${displayName} (${
                  message.member?.voice.channel?.name || "알수없음"
                }) | "${originalText}" → "${parsedText}" | ${voiceName} ${speed}%`
              );
            } catch (error) {
              logger.error(
                `❌ 재생 실패: [${message.guild.name}] ${displayName}`,
                error
              );
              guildData.action.send("오디오 재생 중 오류가 발생했습니다.");
            }
          },
          voiceName,
          speed
        );
      } catch (e) {
        logger.error(
          `❌ TTS 오류: [${message.guild.name}] ${displayName} | "${parsedText}"`,
          e
        );
        await guildData.action.reply("TTS 생성 중 오류가 발생했습니다.");
      }

      // 30분 후 자동으로 음성 채널에서 나가는 타임아웃 설정
      if (guildData.timeOut) {
        clearTimeout(guildData.timeOut);
      }

      const timeOut: NodeJS.Timeout = setTimeout(async () => {
        try {
          if (!getVoiceConnection(message.guildId)) return;
          if (guildData) {
            // 오디오 플레이어 정리
            if (guildData.audioPlayer) {
              guildData.audioPlayer.stop();
              guildData.audioPlayer = null;
            }

            // 음성 연결 종료
            getVoiceConnection(message.guildId)?.destroy();

            await guildData?.action.send("tts가 종료되었습니다.");
            logger.info(
              `⏱️ TTS 세션 타임아웃: 서버 '${message.guild.name}' (ID: ${message.guildId}) | 연결 해제됨`
            );
          }
        } catch (error) {
          logger.error(
            `❌ TTS 타임아웃 정리 오류: 서버 '${message.guild.name}' (ID: ${message.guildId})`,
            error
          );
        }
      }, 1800_000);
      guildData.timeOut = timeOut;
    }
  } catch (error) {
    logger.error("메시지 처리 오류:", error);
  }
});

/**
 * 음성 상태 변경 이벤트 핸들러
 * 사용자가 음성 채널을 떠날 때 처리
 *
 * @remarks
 * 음성 채널에 봇만 남게 되면 자동으로 나감
 */
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

        // 음성 채널에 남은 사람이 없는지 확인 (봇 제외)
        if (nonBotMembers.size === 0) {
          connection.destroy();
          const guildData: GuildData | undefined = guildDataList.find(
            (data) => data.guildId == oldState.guild.id
          );
          if (guildData) {
            // 타임아웃 정리
            if (guildData.timeOut) {
              clearTimeout(guildData.timeOut);
              guildData.timeOut = null;
            }

            // 오디오 플레이어 정리
            if (guildData.audioPlayer) {
              guildData.audioPlayer.stop();
              guildData.audioPlayer = null;
            }
          }

          logger.info(
            `🚪 빈 음성 채널에서 봇 자동 퇴장: 서버 '${oldState.guild.name}' (ID: ${oldState.guild.id}) | 채널: '${channel.name}' (ID: ${channel.id})`
          );
        }
      }
    }
  } catch (error) {
    logger.error(
      `❌ 음성 상태 업데이트 처리 오류: 서버 '${oldState.guild?.name}' (ID: ${oldState.guild?.id})`,
      error
    );
  }
});

/**
 * 길드(서버) 삭제 이벤트 핸들러
 * 봇이 서버에서 제거되거나 나갈 때 메모리와 데이터베이스 정리
 */
client.on(Events.GuildDelete, async (guild) => {
  try {
    logger.warn(`🚪 서버에서 봇 제거됨: "${guild.name}" (ID: ${guild.id})`);

    // guildDataList에서 해당 서버 데이터 제거
    const guildDataIndex = guildDataList.findIndex(
      (data) => data.guildId === guild.id
    );

    if (guildDataIndex !== -1) {
      const guildData = guildDataList[guildDataIndex];

      // 타임아웃 정리
      if (guildData.timeOut) {
        clearTimeout(guildData.timeOut);
        guildData.timeOut = null;
      }

      // 오디오 플레이어 정리
      if (guildData.audioPlayer) {
        guildData.audioPlayer.stop();
        guildData.audioPlayer = null;
      }

      // 음성 연결 정리
      const voiceConnection = getVoiceConnection(guild.id);
      if (voiceConnection) {
        voiceConnection.destroy();
      }

      // 리스트에서 제거
      guildDataList.splice(guildDataIndex, 1);
      logger.info(
        `✅ 서버 "${guild.name}" 데이터 정리 완료 (남은 서버: ${guildDataList.length}개)`
      );
    }

    // DB에서 서버 데이터 제거
    try {
      const deletedJoins = await JoinedServer.destroy({
        where: { server_id: guild.id },
      });

      const deletedServer = await Servers.destroy({
        where: { id: guild.id },
      });

      if (deletedServer > 0) {
        logger.info(
          `✅ 데이터베이스에서 서버 "${guild.name}" (ID: ${guild.id}) 제거 완료 (${deletedJoins}개 사용자 관계 삭제)`
        );
      }
    } catch (dbError) {
      logger.error(
        `❌ 데이터베이스에서 서버 "${guild.name}" (ID: ${guild.id}) 제거 실패:`,
        dbError
      );
    }
  } catch (error) {
    logger.error("길드 삭제 처리 오류:", error);
  }
});

/**
 * 길드(서버) 생성 이벤트 핸들러
 * 봇이 새로운 서버에 추가될 때 자동으로 등록
 */
client.on(Events.GuildCreate, async (guild) => {
  try {
    logger.info(
      `🎉 새로운 서버에 봇 추가됨: "${guild.name}" (ID: ${guild.id}, 멤버: ${guild.memberCount}명)`
    );

    // DB에 서버 등록
    const [server, created] = await Servers.findOrCreate({
      where: { id: guild.id },
      defaults: { id: guild.id },
    });

    if (created) {
      logger.info(
        `✅ 새 서버 "${guild.name}" (ID: ${guild.id}) 데이터베이스에 등록`
      );
    } else {
      logger.info(
        `📝 서버 "${guild.name}" (ID: ${guild.id})가 이미 데이터베이스에 존재`
      );
    }

    // guildDataList에 추가 (아직 없는 경우)
    const existingData = guildDataList.find(
      (data) => data.guildId === guild.id
    );
    if (!existingData) {
      guildDataList.push({
        guildId: guild.id,
        audioPlayer: null,
        action: new Action(),
        timeOut: null,
      });
      logger.info(`✅ 서버 "${guild.name}"를 활성 서버 목록에 추가`);
    }
  } catch (error) {
    logger.error("길드 생성 처리 오류:", error);
  }
});

/**
 * Discord 클라이언트 로그인
 */
client.login(TOKEN);

/**
 * 메시지 내용 파싱 함수
 * TTS를 위해 메시지를 처리하고 정리
 *
 * @param messageContent - 원본 메시지 내용
 * @returns 파싱된 메시지 문자열
 *
 * @remarks
 * - 200자로 자름
 * - 멘션, 역할, 채널, 이모지, URL 등을 적절한 텍스트로 변환
 * - 한글 자음/모음을 읽을 수 있는 형태로 변환
 * - 초성체(ㄱㅅ, ㅇㅈ 등)를 풀어서 변환
 * - 특수문자 제거
 */
// function parseMessage(messageContent: string): string {
//   // URL 제거
//   const urlRegex = /(https?:\/\/[^\s]+)/g;
//   let cleanMessage = messageContent.replace(urlRegex, "링크");

//   return cleanMessage;
// }

function parseMessage(messageContent: string): string {
  const truncateToLimit = (text: string) =>
    Array.from(text).slice(0, TTS_LIMIT).join("");

  // 빠른 단축어 처리
  if (messageContent == "ㅋ") return "킥";
  else if (messageContent == "ㅋㅋ") return "크크";
  else if (messageContent == "ㅋㅋㅋ") return "크크크";
  else if (messageContent == "ㅇㅇ") return "응응";
  else if (messageContent == "ㅎㅇ") return "하이";
  else if (messageContent == "ㅂㅇ") return "바이";
  else if (messageContent == "ㅃㅇ") return "빠이";
  else if (messageContent == "ㅃㅃ") return "빠빠";
  else if (messageContent == "ㄷㄷ") return "덜덜";
  else if (messageContent == "ㄹㅇ") return "레알";
  else if (messageContent == "ㅇㅋ") return "오키";

  // 멘션, 역할, 채널, 이모지, URL 처리, new line 제거
  // - 유저 멘션은 <@id>, <@!id> 형태 모두 존재
  // - 커스텀 이모지는 <:name:id>, <a:name:id> (animated) 형태 모두 존재
  const mentionReg = /<@!?([0-9]{3,})>/gi;
  const roleReg = /<@&([0-9]{3,})>/gi;
  const channelReg = /<#([0-9]{3,})>/gi;
  const emojiReg = /<a?\:[^\:]+\:([0-9]{3,})>/gi;
  // 메시지 전체가 URL일 때만 매칭되던 ^...$ 패턴을 제거하고, 문장 내 URL도 치환
  const urlReg =
    /(?:file|gopher|news|nntp|telnet|https?|ftps?|sftp):\/\/[\w\-._~:/?#[\]@!$&'()*+,;=%]+/gi;
  messageContent = messageContent
    .replace(mentionReg, " 멘션 ")
    .replace(roleReg, " 역할 ")
    .replace(channelReg, " 채널 ")
    .replace(emojiReg, " 이모지 ")
    .replace(urlReg, " 링크 ");

  // 속삭임과 특수문자 제거 (괄호, 점, 부등호, 앰퍼샌드, 따옴표, 샵, 골뱅이, 콜론, 개행)
  const wisperReg = /\([^)]+\)/gi;
  const specialCharactersReg = /[\(\)\.\>\<\&\"\'\#\@\:\n\r\t]/gi;
  messageContent = messageContent
    .replace(wisperReg, " ")
    .replace(specialCharactersReg, " ");

  // 예외 처리 (이모티콘)
  const regException = /ㅇㅅㅇ|ㅡㅅㅡ|ㅎㅅㅎ/gi;
  messageContent = messageContent.replace(regException, " ");

  // 한글 자음 모음 정리
  const regㅏ = /[ㅏ]/gi;
  const regㅑ = /[ㅑ]/gi;
  const regㅓ = /[ㅓ]/gi;
  const regㅕ = /[ㅕ]/gi;
  const regㅗ = /[ㅗ]/gi;
  const regㅛ = /[ㅛ]/gi;
  const regㅜ = /[ㅜ]/gi;
  const regㅠ = /[ㅠ]/gi;
  const regㅡ = /[ㅡ]/gi;
  const regㅣ = /[ㅣ]/gi;
  const regㅐ = /[ㅐ]/gi;
  const regㅒ = /[ㅒ]/gi;
  const regㅔ = /[ㅔ]/gi;
  const regㅖ = /[ㅖ]/gi;
  const regㅘ = /[ㅘ]/gi;
  const regㅙ = /[ㅙ]/gi;
  const regㅚ = /[ㅚ]/gi;
  const regㅝ = /[ㅝ]/gi;
  const regㅞ = /[ㅞ]/gi;
  const regㅟ = /[ㅟ]/gi;
  const regㅢ = /[ㅢ]/gi;
  messageContent = messageContent
    .replace(regㅏ, "아")
    .replace(regㅑ, "야")
    .replace(regㅓ, "어")
    .replace(regㅕ, "여")
    .replace(regㅗ, "오")
    .replace(regㅛ, "요")
    .replace(regㅜ, "우")
    .replace(regㅠ, "유")
    .replace(regㅡ, "으")
    .replace(regㅣ, "이")
    .replace(regㅐ, "애")
    .replace(regㅒ, "얘")
    .replace(regㅔ, "에")
    .replace(regㅖ, "예")
    .replace(regㅘ, "와")
    .replace(regㅙ, "왜")
    .replace(regㅚ, "외")
    .replace(regㅝ, "워")
    .replace(regㅞ, "웨")
    .replace(regㅟ, "위")
    .replace(regㅢ, "의");

  // 한글 초성체를 실제 단어로 변환
  const regㄴㅇㄱ = /ㄴㅇㄱ/gi; // 상상도 못한 정체!
  const regㄴㅆㄴ = /ㄴㅆㄴ/gi; // 넌 씨발 눈치도 없냐?
  const regㄷㅈㄹ = /ㄷㅈㄹ/gi; // 뒤질래?
  const regㄸㄹㅇ = /ㄸㄹㅇ/gi; // 또라이
  const regㅅㄱㅇ = /ㅅㄱㅇ/gi; // 수고요
  const regㅅㄱㄹ = /ㅅㄱㄹ/gi; // 수고링
  const regㅇㅈㄹ = /ㅇㅈㄹ/gi; // 이지랄
  const regㄹㅈㄷ = /ㄹㅈㄷ/gi; // 레전드
  const regㅎㅇㅌ = /ㅎㅇㅌ/gi; // 화이팅
  const regㅇㅇ = /ㅇㅇ/gi; // 응응
  const regㄴㄴ = /ㄴㄴ/gi; // 노노
  const regㅎㅇ = /ㅎㅇ/gi; // 하이
  const regㅂㅇ = /ㅂㅇ/gi; // 바이
  const regㅃㅇ = /ㅃㅇ/gi; // 빠이
  const regㅂㅂ = /ㅂㅂ/gi; // 바이바이
  const regㅃㅃ = /ㅃㅃ/gi; // 빠빠
  const regㅂ2 = /ㅂ2/gi; // 바이
  const regㄷㄷ = /ㄷㄷ/gi; // 덜덜
  const regㄹㅇ = /ㄹㅇ/gi; // 레알
  const regㅇㅋ = /ㅇㅋ/gi; // 오키
  const regㄱㄷ = /ㄱㄷ/gi; // 기달
  const regㄱㅅ = /ㄱㅅ/gi; // 감사
  const regㅇㅈ = /ㅇㅈ/gi; // 인정
  const regㅈㅅ = /ㅈㅅ/gi; // 죄송
  const regㄲㅈ = /ㄲㅈ/gi; // 꺼져
  const regㅈㅂ = /ㅈㅂ/gi; // 제발
  const regㅈㅁ = /ㅈㅁ/gi; // 잠시만
  const regㅈㄹ = /ㅈㄹ/gi; // 지랄
  const regㄴㄱ = /ㄴㄱ/gi; // 누구?
  const regㄴㅈ = /ㄴㅈ/gi; // 노잼
  const regㄷㅈ = /ㄷㅈ/gi; // 닥전
  const regㄷㅎ = /ㄷㅎ/gi; // 닥후
  const regㄷㅊ = /ㄷㅊ/gi; // 닥쳐
  const regㄸㅋ = /ㄸㅋ/gi; // 땡큐
  const regㅁㄹ = /ㅁㄹ/gi; // 몰라
  const regㅁㅊ = /ㅁㅊ/gi; // 미친
  const regㅃㄹ = /ㅃㄹ/gi; // 빨리
  const regㅇㅎ = /ㅇㅎ/gi; // 아하
  const regㅅㅂ = /ㅅㅂ/gi; // 씨발
  const regㅊㅊ = /ㅊㅊ/gi; // 축축
  const regㅋ = /[ㅋ]/gi; // 크
  const regㅎ = /[ㅎ]/gi; // 흐
  messageContent = messageContent
    .replace(regㄴㅇㄱ, "상상도 못한 정체!")
    .replace(regㄴㅆㄴ, "넌 씨발 눈치도 없냐?")
    .replace(regㄷㅈㄹ, "뒤질래?")
    .replace(regㄸㄹㅇ, "또라이")
    .replace(regㅅㄱㅇ, "수고요")
    .replace(regㅅㄱㄹ, "수고링")
    .replace(regㅇㅈㄹ, "이지랄")
    .replace(regㄹㅈㄷ, "레전드")
    .replace(regㅎㅇㅌ, "화이팅")
    .replace(regㅇㅇ, "응응")
    .replace(regㄴㄴ, "노노")
    .replace(regㅎㅇ, "하이")
    .replace(regㅂㅇ, "바이")
    .replace(regㅃㅇ, "빠이")
    .replace(regㅂㅂ, "바이바이")
    .replace(regㅃㅃ, "빠빠")
    .replace(regㅂ2, "바이")
    .replace(regㄷㄷ, "덜덜")
    .replace(regㄹㅇ, "레알")
    .replace(regㅇㅋ, "오키")
    .replace(regㄱㄷ, "기달")
    .replace(regㄱㅅ, "감사")
    .replace(regㅇㅈ, "인정")
    .replace(regㅈㅅ, "죄송")
    .replace(regㄲㅈ, "꺼져")
    .replace(regㅈㅂ, "제발")
    .replace(regㅈㅁ, "잠시만")
    .replace(regㅈㄹ, "지랄")
    .replace(regㄴㄱ, "누구?")
    .replace(regㄴㅈ, "노잼")
    .replace(regㄷㅈ, "닥전")
    .replace(regㄷㅎ, "닥후")
    .replace(regㄷㅊ, "닥쳐")
    .replace(regㄸㅋ, "땡큐")
    .replace(regㅁㄹ, "몰라")
    .replace(regㅁㅊ, "미친")
    .replace(regㅃㄹ, "빨리")
    .replace(regㅇㅎ, "아하")
    .replace(regㅅㅂ, "씨발")
    .replace(regㅊㅊ, "축축")
    .replace(regㅋ, "크")
    .replace(regㅎ, "흐");

  /**
   * HTML 엔티티 인코딩 (현재 비활성화)
   */
  // const gtReg = /[>]/gi;
  // const ltReg = /[<]/gi;
  // const ampReg = /[&]/gi;
  // const quoteReg = /["]/gi;
  // const aposReg = /[']/gi;

  // messageContent = messageContent.replace(gtReg, "&gt;");
  // messageContent = messageContent.replace(ltReg, "&lt;");
  // messageContent = messageContent.replace(ampReg, "&amp;");
  // messageContent = messageContent.replace(quoteReg, "&quot;");
  // messageContent = messageContent.replace(aposReg, "&apos;");

  // 공백 정리 + 앞뒤 trim (치환 과정에서 공백이 누적되는 경우가 많음)
  messageContent = messageContent.replace(/\s+/g, " ").trim();

  // 치환 결과가 200자를 넘을 수 있으므로 최종 결과도 200자로 제한
  return truncateToLimit(messageContent);
}

/**
 * 인터랙션에서 닉네임 가져오기
 *
 * @param interaction - Discord 인터랙션 객체
 * @returns 사용자의 표시 이름 또는 사용자명
 */
function getNickName(interaction: Interaction): string {
  if (interaction.member instanceof GuildMember) {
    return interaction.member.displayName;
  }
  if ("user" in interaction) {
    return interaction.user.username;
  }
  return "Unknown";
}

/**
 * 새로운 오디오 플레이어 생성
 *
 * @returns 설정된 AudioPlayer 인스턴스
 */
function createNewAudioPlayer() {
  return createAudioPlayer({
    behaviors: {
      noSubscriber: NoSubscriberBehavior.Pause,
    },
  });
}

/**
 * Ogg Opus 오디오 리소스 생성
 *
 * @param stream - 오디오 스트림
 * @param inputType - 스트림 타입 (기본값: OggOpus)
 * @returns AudioResource 인스턴스
 */
function createNewOggOpusAudioResource(
  stream: Stream.Readable,
  inputType: StreamType | undefined = undefined
) {
  const resource = createAudioResource(stream, {
    inputType: inputType ?? StreamType.OggOpus,
  });
  return resource;
}
