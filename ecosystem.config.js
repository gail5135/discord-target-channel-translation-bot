// pm2 설정. 자격증명은 여기에 넣지 않는다 — 이 파일은 공개 저장소에 커밋되며,
// 토큰과 API 키는 서버의 .env에만 두고 dotenv가 읽는다(src/index.ts).
module.exports = {
  apps: [
    {
      name: 'discord-translation-bot',

      // 컴파일된 JS를 node로 직접 실행한다. npm을 거치면 pm2가 관리하는 대상이
      // npm 래퍼 프로세스가 되어 재시작과 시그널 전달이 한 단계 어긋난다.
      // 배포 전 `npm run build`로 dist를 만들어야 한다 — dist는 저장소에 없다.
      script: 'dist/index.js',

      // script가 상대 경로인 데다, dotenv(dist/index.js)는 process.cwd() 기준으로
      // .env를 찾는다. cwd를 명시하지 않으면 저장소 루트 밖에서 pm2 start를 실행했을 때
      // .env를 못 찾고 DISCORD_TOKEN 오류로 크래시 루프에 빠진다.
      cwd: __dirname,

      // 인스턴스가 둘이면 같은 토큰으로 게이트웨이에 두 번 붙고 메시지가 두 번 게시된다.
      // 개발 중 실제로 겪은 문제라 fork/1을 명시적으로 못박는다.
      instances: 1,
      exec_mode: 'fork',

      autorestart: true,

      // .env가 없거나 API 키가 하나도 없으면 봇은 기동 즉시 종료된다(의도된 동작).
      // 기본 설정이면 pm2가 이것을 무한히 재시작하며 공유 vCPU 한 개를 태운다.
      // 60초를 못 버틴 기동이 5번 반복되면 포기하고 errored 상태로 남긴다.
      min_uptime: '60s',
      max_restarts: 5,
      restart_delay: 5000,

      // 누수를 잡기 위한 선. 컴파일된 JS를 돌리므로 ts-node가 상주시키던 TypeScript
      // 컴파일러 몫(측정값 약 290MB)이 사라졌다 — 모듈 로드 직후 RSS가 약 80MB다.
      // 게이트웨이 연결과 길드 캐시를 얹어도 여유가 있고, 누수는 RAM 1GB 서버가
      // 힘들어지기 한참 전에 걸린다.
      max_memory_restart: '250M',

      // 로그 줄마다 타임스탬프. 로깅 라이브러리를 두지 않는 대신 pm2가 붙인다.
      time: true,
    },
  ],
};
