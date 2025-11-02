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
      name: 'juhee-bot-sharded',
      script: './.cache/app/shard.js',
      cwd: './',
      
      // 실행 모드
      instances: 1, // 샤드 매니저는 단일 인스턴스로 실행
      exec_mode: 'fork',
      
      // 환경 변수
      env: {
        NODE_ENV: 'production',
      },
      
      // 자동 재시작 설정
      autorestart: true,
      watch: false,
      max_memory_restart: '2G', // 샤딩 사용 시 메모리 제한 증가
      
      // 재시작 전략
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 4000,
      
      // 로그 관리
      error_file: './logs-prod/error-sharded.log',
      out_file: './logs-prod/out-sharded.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      
      // 무중단 배포 설정
      wait_ready: true,
      listen_timeout: 60000, // 샤딩 시작 시간이 더 걸리므로 타임아웃 증가
      kill_timeout: 10000, // 모든 샤드 종료 시간 고려
      
      // 시간 설정
      time: true,
    },
    {
      // ===== 샤딩을 사용하지 않는 경우 (기본) =====
      // 소규모 봇 (2,500개 서버 미만)이거나 테스트용으로 사용
      name: 'juhee-bot',
      script: './.cache/app/index.js',
      cwd: './',
      
      // 실행 모드
      instances: 1,
      exec_mode: 'fork',
      
      // 환경 변수
      env: {
        NODE_ENV: 'production',
      },
      
      // 자동 재시작 설정
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      
      // 재시작 전략
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 4000,
      
      // 로그 관리
      error_file: './logs-prod/error.log',
      out_file: './logs-prod/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      
      // 무중단 배포 설정
      wait_ready: true,
      listen_timeout: 10000,
      kill_timeout: 5000,
      
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
  deploy: {
    production: {
      // SSH 설정
      user: 'ubuntu', // 서버 사용자명
      host: 'your-server-ip', // 서버 IP 또는 도메인
      ref: 'origin/main', // 배포할 브랜치
      repo: 'git@github.com:kevin1113-github/juhee-bot.git', // Git 저장소
      path: '/home/ubuntu/juhee-bot', // 서버의 배포 경로
      
      // 배포 후 실행할 명령어
      'pre-deploy-local': 'echo "로컬에서 배포 전 실행"',
      'post-deploy': 
        'npm install && ' +
        'npm run build && ' +
        'pm2 reload ecosystem.config.cjs --env production && ' +
        'pm2 save',
      
      // 환경 변수
      env: {
        NODE_ENV: 'production',
      },
    },
  },
};
