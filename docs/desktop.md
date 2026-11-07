# Windows EXE 공통 배포 절차

Boids·PBD·SPH는 동일한 명령과 Windows x64 포터블 형식을 사용합니다.
각 프로젝트는 자신의 package-lock.json과 node_modules만 사용합니다.

## 개발자 명령

```powershell
npm.cmd ci --ignore-scripts
node node_modules/electron/install.js
npm.cmd run release:exe
```

C++ 원본을 수정했다면 Emscripten 4.0.23으로 `npm.cmd run build:core`를 먼저 실행합니다.
원본/Wasm 해시가 다르면 패키징은 실패합니다. Electron 44.9.3과 electron-builder 26.15.3을
고정합니다. 최초 설치·패키징에는 npm 및 Electron/NSIS 다운로드 연결이 필요합니다.

| 명령 | 작업 |
| --- | --- |
| `npm.cmd run build:web` | EXE용 웹 자원 생성; PBD는 기존 0.139.2 UMD 자원을 로컬 포함 |
| `npm.cmd run build:exe` | 원본/Wasm 검사 → 웹 생성 → 포터블 EXE → SHA-256 |
| `npm.cmd run test:exe` | 실제 EXE만 한글·공백 폴더에 복사 → 숨김 창 기능 검사 |
| `npm.cmd run release:exe` | build → check → test:distribution → build:exe → test:exe → 검증된 배포 manifest |

상위 과제 모음 루트의 `npm.cmd run release:exe`는 세 프로젝트를 차례로 검사하고,
검증된 EXE·체크섬·manifest를 새 `output/simulation-exe-*/` 폴더에 모읍니다.
프로젝트를 단독으로 복사한 경우 프로젝트 내부 명령만 사용하면 됩니다.

## 배포물과 실행

`release/<제품명>-<version>-win-x64.exe` 하나를 복사하여 더블클릭합니다.
사용자 PC에 Node.js·Python·브라우저·SDK·인터넷·별도 서버가 필요하지 않습니다.
포터블 실행 시 내부 런타임은 임시 폴더에 풀리고 사용자 프로필에 캐시가 남을 수 있습니다.
코드 서명은 적용하지 않으며 관리자 권한·자동 업데이트를 사용하지 않습니다.
Windows x64와 각 렌더러가 요구하는 그래픽 드라이버/WebGL 환경이 필요합니다.

`.exe.sha256`은 무결성 확인용입니다. `release-manifest.json`은 실제 검사한 EXE의
해시·크기·버전·기능 검사·오류·외부 요청 기록을 담습니다. 실행에 필수인 부속 파일은 아닙니다.
배포 검사가 실패하면 이전 성공 manifest를 제거하고 새 성공 기록을 만들지 않습니다.
`win-unpacked/`와 builder 설정 로그는 내부 중간 결과입니다.

```powershell
Get-FileHash .\release\<실제-파일명>.exe -Algorithm SHA256
```

## 구현과 검증 범위

`desktop/config.cjs`는 제품 ID·자원 허용 목록·CSP를 정의합니다.
`desktop/main.cjs`, `tools/package-desktop.mjs`, `tools/release-desktop.mjs`,
`tests/desktop/desktop.mjs`는 세 프로젝트에 같은 구현을 보관합니다.
상위 배포 명령은 이 네 파일의 동일성을 검사합니다. 이웃 프로젝트에 런타임 의존하지 않습니다.
파일 선별은 새 임시 staging에서 수행하며 개발 node_modules·소스 자료·PDF·영상을 포함하지 않습니다.
라이선스 고지는 앱 자원과 Electron 런타임에 보존합니다.

렌더러는 Node 통합을 끄고 context isolation·sandbox를 켭니다. 자체 프로토콜의 허용된 자원만
제공하고 외부 HTTP/WebSocket 및 file 요청을 차단합니다. SPH의 사용자가 요청한 로컬 Blob
내보내기는 허용합니다. SPH 단독 HTML은 내장 스크립트·Blob Worker를 위해 별도 CSP를 사용합니다.

`artifacts/desktop-results.json`은 이번 EXE의 실제 검사 결과이며,
`artifacts/desktop-exe.png`는 패키지 렌더러의 화면입니다.
Boids는 기존 장애물·목표·포식자·경계·일시정지 검사, PBD는 기존 UI 회귀 26개와 해제 검사,
SPH는 Worker 초기화·10스텝 진행·표시 전환·JSON 저장·해제를 검사합니다.
숨김 창 검사는 FPS·GPU 성능 측정이나 다른 PC 호환성 검증을 의미하지 않습니다.
이 명령은 로컬 배포물을 생성하며 GitHub 업로드는 수행하지 않습니다.


웹·폴더 경로는 [공통 폴더·빌드 구조](project-layout.md)를 따릅니다.
PBD/SPH의 기존 Embind 로더에는 동적 함수 생성이 있어 해당 CSP에 unsafe-eval을 허용합니다.
렌더러의 Node API 비활성화·sandbox·외부 네트워크 차단은 함께 적용합니다.
