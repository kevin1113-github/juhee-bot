/**
 * PM2 Ecosystem Configuration for Juhee Bot
 * 
 * PM2를 사용한 무중단 배포 및 프로세스 관리 설정
 * 
 * 주요 기능:
 * - 무중단 배포 (zero-downtime deployment)
 * - 자동 재시작 (오류 발생 시)
 * - 로그 관리 (rotation)
 * - 샤딩 지원 (Discord Sharding)
 */

module.exports = {
  apps: [
    {
      // ===== 샤딩을 사용하는 경우 (권장) =====
      name: 'juhee-bot',
      script: './.cache/app/index.js',
      cwd: './',
      
      // 실행 모드
      instances: 1, // 샤드 매니저는 단일 인스턴스로 실행
      exec_mode: 'fork',

      // Node.js 실행 옵션 (V8 힙 상한으로 스왑/OOM 유발 억제)
      // 샤드 매니저 프로세스 기준. 서버 램 규모에 맞춰 조정 가능.
      node_args: '--max-old-space-size=512',

      // 환경 변수
      env: {
        NODE_ENV: 'production',
      },

      // 자동 재시작 설정
      autorestart: true,
      watch: false,
      max_memory_restart: '1G', // 힙 상한(512MB)과 네이티브 메모리를 고려한 상한

      // 재시작 전략
      // 이전 설정(max_restarts:10, min_uptime:10s)은 네트워크 오류가 잠깐 몰리면
      // PM2가 봇을 영구 정지시켜 다운 상태로 방치되는 원인이었다.
      min_uptime: '30s', // 30초 이상 살아있으면 정상 기동으로 간주 (ONNX 워밍업 시간 고려)
      max_restarts: 50,
      restart_delay: 5000,
      exp_backoff_restart_delay: 100, // 재시작 폭주 시 지수 백오프로 완화
      
      // 로그 관리
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      
      // 무중단 배포 설정
      wait_ready: true,
      listen_timeout: 60000, // 샤딩 시작 시간이 더 걸리므로 타임아웃 증가
      kill_timeout: 10000, // 모든 샤드 종료 시간 고려
      
      // 시간 설정
      time: true,
    },
  ],

  /**
   * 배포 설정 (옵션)
   * 
   * PM2를 사용한 원격 배포 설정
   * 사용법: pm2 deploy <environment> <command>
   * 예: pm2 deploy production setup
   *     pm2 deploy production update
   */
  // deploy: {
  //   production: {
  //     // SSH 설정
  //     user: 'ubuntu', // 서버 사용자명
  //     host: 'your-server-ip', // 서버 IP 또는 도메인
  //     ref: 'origin/main', // 배포할 브랜치
  //     repo: 'git@github.com:kevin1113-github/juhee-bot.git', // Git 저장소
  //     path: '/home/ubuntu/juhee-bot', // 서버의 배포 경로
      
  //     // 배포 후 실행할 명령어
  //     'pre-deploy-local': 'echo "로컬에서 배포 전 실행"',
  //     'post-deploy': 
  //       'npm install && ' +
  //       'npm run build && ' +
  //       'pm2 reload ecosystem.config.cjs --env production && ' +
  //       'pm2 save',
      
  //     // 환경 변수
  //     env: {
  //       NODE_ENV: 'production',
  //     },
  //   },
  // },
};
