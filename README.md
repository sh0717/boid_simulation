# Murmuration — Boids Lab

분리·정렬·응집 규칙으로 3차원 군집 운동을 구현한 시뮬레이션입니다.
**C++20 / WebAssembly / Three.js / Electron**을 사용합니다.

![군집 시뮬레이션 화면](docs/images/boids-overview.png)

## 주요 기능

- 최대 1,200개 개체, 군집 가중치·인지 반경·시야각 조절, Grid / KD-tree 탐색 전환
- 목표 추적·포식자 회피·구와 박스 장애물 편집·월드 경계 설정
- 개체별 이웃·조향 벡터 관찰, 일시정지·한 스텝 진행·시드 기반 재현

## 실행

**바로 실행:** 저장소를 ZIP으로 내려받아 폴더 전체를 압축 해제한 뒤 `index.html`을
Chrome 또는 Edge로 엽니다. WebGL 2가 필요하며 `dist/` 등 상대 경로를 유지해야 합니다.
Node.js나 C++ 도구 설치는 필요하지 않습니다.

**개발 서버:** Node.js 22.20.0 기준으로 프로젝트 루트에서 실행합니다.

```powershell
npm.cmd ci --ignore-scripts
npm.cmd run build
npm.cmd start
```

브라우저에서 **http://127.0.0.1:4173**에 접속합니다. macOS/Linux에서는 `npm.cmd` 대신 `npm`을 사용합니다.

## 개발

| 명령 | 용도 |
| --- | --- |
| `npm.cmd run build` | 기존 Wasm으로 웹 빌드 |
| `npm.cmd run build:all` | C++ 변경 후 Wasm·웹 재빌드 — Emscripten 4.0.23 필요 |
| `npm.cmd run check` | 서식·구조·Wasm 해시·Node 회귀 검사 — clang-format 필요 |
| `npm.cmd run test:native` | 네이티브 C++ 빌드·테스트 — Windows MSVC·CMake 필요 |

화면은 `src/`, C++ 코어는 `native/`에서 수정합니다.
전체 갱신 순서는 [Simulation.cpp](native/bindings/Simulation.cpp),
군집 계산은 [BirdFlock.cpp](native/src/simulation/BirdFlock.cpp)에서 확인합니다.

## 문서

- [기술 문서 목차](docs/README.md): 이론·수식·탐색 알고리즘·아키텍처
- [C++/Wasm 개발](docs/cpp-core.md) · [VS Code 설정과 디버깅](docs/vscode.md)
- [검증 방법](docs/verification.md) · [Windows EXE 배포](docs/desktop.md)
- [GitHub 업로드 안내](docs/github-upload.md)

Boids 원 개념: [Craig Reynolds](https://www.red3d.com/cwr/boids/).
외부 라이선스: [Three.js](dist/THREE-LICENSE.txt) · [Emscripten 코어](dist/CORE-LICENSES.txt).
