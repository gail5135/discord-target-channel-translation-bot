import path from 'node:path';

/**
 * config.json의 정식 위치 — 저장소 루트.
 *
 * `process.cwd()`를 쓰지 않는 이유: pm2가 어느 디렉토리에서 실행하든 같은 파일을
 * 가리켜야 한다.
 *
 * `__dirname`만 쓰지 않는 이유: 컴파일하면 이 파일이 `dist/store/`로 옮겨가는데
 * `dist`는 빌드할 때마다 통째로 다시 만들어진다. 그 안에 설정을 두면 갱신할 때마다
 * 사용자 설정이 날아간다. `src/store/`와 `dist/store/` 모두 루트에서 두 단계
 * 아래라, 아래 식이 컴파일 전후 양쪽에서 같은 파일을 가리킨다.
 */
export const CONFIG_PATH = path.join(__dirname, '..', '..', 'config.json');
