import path from 'node:path';

/**
 * config.json의 정식 위치. `process.cwd()`가 아니라 `__dirname` 기준으로 잡아,
 * pm2가 어느 디렉토리에서 실행하든 같은 파일을 가리키게 한다.
 */
export const CONFIG_PATH = path.join(__dirname, 'config.json');
