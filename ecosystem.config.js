// pm2 설정. 자격증명은 여기에 넣지 않는다 — 이 파일은 공개 저장소에 커밋되며,
// 토큰과 API 키는 서버의 .env에만 두고 dotenv가 읽는다(src/index.ts).
module.exports = {
  apps: [
    {
      name: 'discord-translation-bot',

      // ts-node CLI를 node로 직접 실행한다. npm을 거치면 pm2가 관리하는 대상이
      // npm 래퍼 프로세스가 되어 재시작과 시그널 전달이 한 단계 어긋난다.
      script: 'node_modules/ts-node/dist/bin.js',
      args: ['src/index.ts'],

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

      // 누수를 잡기 위한 선. ts-node는 TypeScript 컴파일러를 메모리에 상주시키므로
      // 정상 사용량이 크고, 이 값이 너무 낮으면 정상 동작 중 재시작되어 min_uptime
      // 안에 반복되면 max_restarts에 걸린다. RAM 1GB 서버에서도 정상 사용 범위 내다.
      max_memory_restart: '400M',

      // 로그 줄마다 타임스탬프. 로깅 라이브러리를 두지 않는 대신 pm2가 붙인다.
      time: true,
    },
  ],
};
