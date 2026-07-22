/**
 * @fileoverview 주희봇 샤드 매니저
 * @description Discord 봇을 여러 샤드로 분산하여 대규모 서버를 효율적으로 관리
 * @author kevin1113dev
 * @version 1.0.0
 */

import dotenv from "dotenv";
dotenv.config();

import { ShardingManager } from "discord.js";
import fs from "node:fs";
import path from "path";
import { __dirname } from "./const.js";
import { logger } from "./logger.js";

// 로그 일일 로테이션 + 지난 파일 gzip 압축 보관 시작 (삭제하지 않음)
logger.startLogRotationSchedule();

/** Discord 봇 토큰 */
const TOKEN: string = process.env.TOKEN ?? "";
/** Discord 애플리케이션 클라이언트 ID (봇 ID) */
const CLIENT_ID: string = process.env.CLIENT_ID ?? "";
/** 한국 디스코드 리스트 API 토큰 (선택 사항) */
const KOREANBOTS_TOKEN: string = process.env.KOREANBOTS_TOKEN ?? "";

if (!TOKEN) {
  logger.error(
    "❌ Discord 봇 토큰이 설정되지 않았습니다. .env 파일을 확인하세요."
  );
  process.exit(1);
}

if (!CLIENT_ID) {
  logger.error(
    "❌ Discord 애플리케이션 클라이언트 ID(CLIENT_ID)가 설정되지 않았습니다. .env 파일을 확인하세요."
  );
  process.exit(1);
}

if (KOREANBOTS_TOKEN) {
  logger.info("✅ KOREANBOTS_TOKEN이 설정되었습니다. 한국 디스코드 리스트 업데이트가 활성화됩니다.");
} else {
  logger.warn(
    "⚠️ KOREANBOTS_TOKEN이 설정되지 않았습니다. 한국 디스코드 리스트 업데이트가 비활성화됩니다."
  );
}

const extension = process.argv.reduce((ext, arg) => {
  if (arg.endsWith(".ts")) return "ts";
  if (arg.endsWith(".js")) return "js";
  return ext;
}, "js");

// tsx watch(개발 모드)로 실행 중이면 샤드 프로세스에도 동일 로더를 주입한다.
const shardExecArgv = extension === "ts" ? ["--import", "tsx"] : [];

// ⚠️ 중요: ONNX 모델(약 251MB)과 오디오 처리는 매니저(이 프로세스)가 아니라
//   ShardingManager가 fork로 띄우는 자식 샤드 프로세스(bot.js)에서 실행된다.
//   ecosystem.config.cjs의 --max-old-space-size는 매니저에만 적용되므로,
//   실제로 메모리를 먹는 샤드에는 여기서 별도로 힙 상한을 걸어줘야 한다.
//   (걸지 않으면 샤드가 기본 힙 상한까지 GC를 미뤄 RSS가 서버 메모리를 잠식한다.)
const shardMaxOldSpaceMb = Math.max(
  128,
  parseInt(process.env.SHARD_MAX_OLD_SPACE_MB ?? "384", 10) || 384
);
shardExecArgv.push(`--max-old-space-size=${shardMaxOldSpaceMb}`);
logger.info(`   🔷 샤드 힙 상한: --max-old-space-size=${shardMaxOldSpaceMb}MB`);
logger.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
logger.info(`🚀 주희봇 샤드 매니저 시작 중...`);
logger.info(`   🔷 Node.js 버전: ${process.version}`);
logger.info(`   🔷 process.argv: ${process.argv.join(" ")}`);
logger.info(`   🔷 실행 파일 확장자: .${extension}`);
logger.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

/**
 * 샤드 매니저 설정
 *
 * @remarks
 * - totalShards: 'auto'로 설정하면 Discord API가 권장하는 샤드 수를 자동으로 결정
 * - 수동으로 설정하려면 숫자를 입력 (예: 2, 4, 8 등)
 * - 각 샤드는 약 1,000~2,500개 서버를 처리할 수 있음
 */
/**
 * 총 샤드 수 결정
 *
 * @remarks
 * - 각 샤드는 별도 Node 프로세스이며, 프로세스마다 ONNX TTS 모델(약 256MB)을 중복 로드한다.
 *   따라서 서버 수가 적을 때 'auto'로 여러 샤드를 띄우면 메모리를 크게 낭비한다.
 * - 서버가 2,500개 미만이면 1개로 충분하다. 규모가 커지면 TOTAL_SHARDS 환경변수로 조정한다.
 *   (예: TOTAL_SHARDS=2, TOTAL_SHARDS=auto)
 */
const rawTotalShards = process.env.TOTAL_SHARDS ?? "1";
const totalShards: number | "auto" =
  rawTotalShards.trim().toLowerCase() === "auto"
    ? "auto"
    : Math.max(1, parseInt(rawTotalShards, 10) || 1);
logger.info(`   🔷 총 샤드 수 설정: ${totalShards}`);

const manager = new ShardingManager(path.join(__dirname, `bot.${extension}`), {
  token: TOKEN,
  totalShards, // 기본 1개. 'auto' 또는 특정 숫자(TOTAL_SHARDS 환경변수)로 조정
  respawn: true, // 샤드 크래시 시 자동 재시작
  shardArgs: [], // 각 샤드에 전달할 추가 인자
  execArgv: shardExecArgv, // Node.js 실행 옵션
});

/**
 * 샤드 생성 이벤트 핸들러
 * 새로운 샤드가 생성될 때 실행
 */
manager.on("shardCreate", (shard) => {
  logger.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  logger.info(`🔷 샤드 #${shard.id} 생성됨`);
  logger.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  /**
   * 샤드별 메시지 이벤트 핸들러
   * 샤드와 매니저 간 통신
   */
  shard.on("message", (message) => {
    // 샤드에서 보낸 사용자 정의 메시지 처리
    if (message._eval) return; // eval 메시지는 무시

    logger.debug(`📨 샤드 #${shard.id}에서 메시지: ${JSON.stringify(message)}`);
  });

  /**
   * 샤드 준비 완료 이벤트
   */
  shard.on("ready", () => {
    logger.info(`✅ 샤드 #${shard.id} 준비 완료`);
  });

  /**
   * 샤드 재연결 이벤트
   */
  shard.on("reconnecting", () => {
    logger.warn(`🔄 샤드 #${shard.id} 재연결 시도 중...`);
  });

  /**
   * 샤드 연결 끊김 이벤트
   */
  shard.on("disconnect", () => {
    logger.warn(`⚠️ 샤드 #${shard.id} 연결 끊김`);
  });

  /**
   * 샤드 종료 이벤트
   */
  shard.on("death", () => {
    logger.error(`💀 샤드 #${shard.id} 예기치 않게 종료됨`);
  });

  /**
   * 샤드 에러 이벤트
   */
  shard.on("error", (error) => {
    logger.error(`❌ 샤드 #${shard.id} 오류:`, error);
  });
});

/**
 * 전역 에러 핸들러
 */
process.on("unhandledRejection", (reason, promise) => {
  logger.error("💥 샤드 매니저 - 처리되지 않은 Promise rejection:", reason);
  if (reason instanceof Error) {
    logger.error("💥 Stack:", reason.stack);
  }
});

process.on("uncaughtException", (error) => {
  logger.error("💥 샤드 매니저 - 처리되지 않은 예외:", error);
  logger.error("💥 Stack:", error.stack);
  process.exit(1);
});

/**
 * SIGINT 시그널 핸들러 - 정상적인 종료 처리
 */
process.on("SIGINT", async () => {
  logger.info("🛑 SIGINT 신호 수신, 모든 샤드 정상 종료 중...");

  try {
    // 모든 샤드에게 종료 신호 전송
    await manager.broadcastEval(() => {
      process.exit(0);
    });

    logger.info("✅ 모든 샤드 정상 종료 완료");
    logger.cleanup();
    process.exit(0);
  } catch (error) {
    logger.error("❌ 샤드 종료 중 오류:", error);
    process.exit(1);
  }
});

/**
 * SIGTERM 시그널 핸들러 - PM2 등에서 사용
 */
process.on("SIGTERM", async () => {
  logger.info("🛑 SIGTERM 신호 수신, 모든 샤드 정상 종료 중...");

  try {
    await manager.broadcastEval(() => {
      process.exit(0);
    });

    logger.info("✅ 모든 샤드 정상 종료 완료");
    logger.cleanup();
    process.exit(0);
  } catch (error) {
    logger.error("❌ 샤드 종료 중 오류:", error);
    process.exit(1);
  }
});

/**
 * 샤드 매니저 시작
 */
logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
logger.info("🚀 주희봇 샤드 매니저 시작 중...");
logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

manager
  // .spawn({ timeout: 60000 }) // 60초 타임아웃
  .spawn()
  .then(() => {
    logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    logger.info(`✅ 모든 샤드 생성 완료 (총 ${manager.totalShards}개)`);
    logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    // PM2에 ready 신호 전송 (무중단 배포 지원)
    if (process.send) {
      process.send("ready");
      logger.info("📡 PM2에 ready 신호 전송");
    }
  })
  .catch((error) => {
    logger.error("❌ 샤드 생성 실패:", error);
    process.exit(1);
  });

/**
 * 샤드 통계 출력 및 한국 디스코드 리스트 업데이트 (10분마다)
 */
if (KOREANBOTS_TOKEN) {
  setInterval(async () => {
    try {
      const results = await manager.fetchClientValues("guilds.cache.size");
      const totalGuilds = results.reduce(
        (acc: number, guildCount: any) => acc + guildCount,
        0
      );

      // 디스크에 누적 저장된 TTS 캐시 통계(샤드별 파일) 합산
      const ttsTotals = { hits: 0, misses: 0, inflightWaits: 0, errors: 0 };
      try {
        const statsDir = process.env.TTS_CACHE_DIR
          ? path.resolve(process.env.TTS_CACHE_DIR)
          : path.join(process.cwd(), ".ttsCache");

        if (fs.existsSync(statsDir)) {
          const files = fs
            .readdirSync(statsDir)
            .filter(
              (f) => f.startsWith("tts-stats-") && f.toLowerCase().endsWith(".json")
            );

          for (const file of files) {
            try {
              const raw = fs.readFileSync(path.join(statsDir, file), "utf8");
              const s = JSON.parse(raw);
              ttsTotals.hits += Number(s?.hits ?? 0) || 0;
              ttsTotals.misses += Number(s?.misses ?? 0) || 0;
              ttsTotals.inflightWaits += Number(s?.inflightWaits ?? 0) || 0;
              ttsTotals.errors += Number(s?.errors ?? 0) || 0;
            } catch {
              // 개별 파일 파싱 실패는 무시
            }
          }
        }
      } catch (ttsError) {
        logger.warn("⚠️ TTS 캐시 통계(파일) 수집 실패:", ttsError);
      }

      const denom = ttsTotals.hits + ttsTotals.misses;
      const hitRate = denom > 0 ? (ttsTotals.hits / denom) * 100 : 0;

      logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      logger.info("📊 샤드 통계:");
      logger.info(`   🔷 총 샤드 수: ${manager.totalShards}개`);
      logger.info(`   🏢 총 서버 수: ${totalGuilds}개`);
      logger.info(
        `   🔊 TTS 캐시: 히트 ${ttsTotals.hits}, 미스 ${ttsTotals.misses}, 대기 ${ttsTotals.inflightWaits}, 오류 ${ttsTotals.errors}, 히트율 ${hitRate.toFixed(
          1
        )}%`
      );

      // 각 샤드별 서버 수 출력
      results.forEach((guildCount: any, index: number) => {
        logger.info(`   📍 샤드 #${index}: ${guildCount}개 서버`);
      });

      // 한국 디스코드 리스트 업데이트
      try {
        const response = await fetch(
          `https://koreanbots.dev/api/v2/bots/${CLIENT_ID}/stats`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: KOREANBOTS_TOKEN,
            },
            body: JSON.stringify({
              servers: totalGuilds,
              shards: manager.totalShards,
            }),
          }
        );

        if (response.ok) {
          logger.info(`   ✅ 한국 디스코드 리스트 업데이트 성공`);
        } else {
          const errorText = await response.text();
          logger.warn(
            `   ⚠️ 한국 디스코드 리스트 업데이트 실패: ${response.status} - ${errorText}`
          );
        }
      } catch (kbError) {
        logger.warn(`   ⚠️ 한국 디스코드 리스트 업데이트 오류:`, kbError);
      }

      logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    } catch (error) {
      logger.error("❌ 샤드 통계 수집 오류:", error);
    }
  }, 600000); // 10분 (600초)
}

/**
 * 샤드 간 통신 예시
 *
 * @example
 * // 모든 샤드에서 길드 수 가져오기
 * manager.fetchClientValues('guilds.cache.size')
 *   .then(results => console.log(`Total guilds: ${results.reduce((acc, val) => acc + val, 0)}`));
 *
 * @example
 * // 모든 샤드에 브로드캐스트
 * manager.broadcastEval(client => client.guilds.cache.size);
 *
 * @example
 * // 특정 샤드에 명령 전송
 * manager.shards.get(0)?.eval(client => client.guilds.cache.size);
 */
