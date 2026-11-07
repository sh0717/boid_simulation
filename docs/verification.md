# 빌드와 테스트

[프로젝트 README](../README.md) · [C++/Wasm 개발](cpp-core.md)

## 기본 검사

Node.js 22.20.0에서 프로젝트 루트에 다음 명령을 실행합니다.
서식 검사에는 clang-format 22.1.3이 필요합니다.

```powershell
npm.cmd ci --ignore-scripts
npm.cmd run build
npm.cmd run check
```

`build`는 저장소에 포함된 Wasm으로 웹 번들을 생성합니다.
`check`는 서식·소스 구조·C++ 원본/Wasm 해시·Node 회귀를 검사합니다.
C++을 변경했다면 Emscripten 4.0.23을 설정하고 `npm.cmd run build:all`을 먼저 실행합니다.

## 전체 검사

MSVC와 CMake, Emscripten 4.0.23, Chrome이 설치된 환경에서 실행합니다.

```powershell
npm.cmd run verify
```

이 명령은 Wasm·웹 재빌드 → 기본 검사 → 네이티브 Debug/Release CTest → 실제 브라우저 검사 순서로 실행합니다.
검사 도중 실행 소스나 배포 파일이 바뀌면 실패합니다. 로그와 결과 JSON은 로컬 `artifacts/`에 생성됩니다.
GitHub Actions의 `Build and test`도 같은 명령을 실행합니다.

`CI=true` 환경의 브라우저 검사는 [Chromium의 SwiftShader 설정](https://chromium.googlesource.com/chromium/src/+/main/docs/gpu/swiftshader.md)을 사용합니다.
호스트 GPU 드라이버에 의존하지 않고 WebGL 기능을 검사하며, 이때의 프레임 수치는 GPU 성능 측정에 사용하지 않습니다.
로컬 기본 실행은 설치된 Chrome의 기본 렌더러를 사용합니다.

| 검사 | 명령 | 확인하는 동작 |
| --- | --- | --- |
| 단위·수치 회귀 | `npm.cmd test` | 실제 Wasm, 이웃 판정, 시드 재현, 잘못된 입력, 자원 수명 |
| 네이티브 Debug | `npm.cmd run test:native` | C++ ABI·탐색·객체 격리·병렬 갱신 계약 |
| 네이티브 Release | `npm.cmd run test:native:release` | Release 구성의 같은 C++ 계약 |
| 브라우저 | `npm.cmd run test:browser` | 데스크톱·모바일 조작, 선택, 초기화 실패·반복 종료 |
| VS Code | `npm.cmd run test:vscode` | 별도 extension host의 중단점·변수 조회·한 줄 실행 |
| Windows EXE | `npm.cmd run build:exe`, `npm.cmd run test:exe` | Electron 패키징과 실행파일의 기능 |

전체 검사는 VS Code·EXE 패키징 검사나 성능 측정을 포함하지 않습니다.
기능 검사 통과와 성능 개선은 구분하며 측정 방법은 [성능 문서](performance.md)를 확인합니다.

## 2026-11-07: 기본 병렬 실행과 실행기 이름 정리

`FBirdUpdateExecutor`의 네이티브 기본 실행 조건을 개체 2개 이상으로 변경했습니다.
작업 객체와 호출 함수, 작업 게시·완료 대기·워커 반복의 이름을 구체화했습니다.
구조와 대여 수명은 [실행기 설명](cpp-core.md#실행기-이름과-작업-전달)에 기록합니다.

| 실행한 검사 | 결과 |
| --- | --- |
| `npm.cmd run build:all` | Emscripten 4.0.23 C++20/Wasm·웹 재빌드 통과. 31,353바이트·외부 import 없음·고정 2 MiB 유지 |
| `npm.cmd run check` | 서식·구조·원본/Wasm 연결 통과, Node 회귀 115/115 통과 |
| `npm.cmd run test:native` | Debug CTest 2/2 통과 |
| `npm.cmd run test:native:release` | Release CTest 2/2 통과 |
| 병렬 CTest의 실제 출력 | 참여 스레드 4개 재사용, 워커 상한 0의 직렬 실행, 162개 직렬·병렬 군집 시나리오의 전체 버퍼 비트 일치 |
| `BOIDS_ENABLE_THREADS=OFF` 별도 Debug 구성·빌드·CTest | `build/executor-serial-20261107/`에서 1/1 통과. 기본 `build/native/`의 ON 설정 유지 |
| `npm.cmd run test:browser` | 데스크톱·모바일 조작, raycast 선택, 초기화 실패·반복 정리 검사 통과. 브라우저 오류 0, 외부 요청 0 |

Wasm 바이너리 SHA-256은 변경 전과 동일합니다. 네이티브 전용 스레드 정책 변경과 이름 정리 후
원본 해시만 재생성되었습니다. EXE·VS Code 디버거·성능 비교·스레드 sanitizer는 이번 검사에 포함하지 않았습니다.

## 2026-11-07: 실행기 작업 묶음과 책임 분리

공개 `ExecuteBirdRangesAndWait` 호출 형식은 유지하고 내부 작업 정보를 `FBirdUpdateBatch`로 묶었습니다.
작업 게시·호출 스레드 구간 실행·완료 대기를 분리했으며, 구간 분할 공식은 `ExecuteRange`에서 공유합니다.
작업 콜백의 대여 수명·워커 재사용·직렬/병렬 선택 정책은 유지합니다.

| 실행한 검사 | 결과 |
| --- | --- |
| `npm.cmd run verify` | Wasm·웹 재빌드, 서식·구조·원본/Wasm 연결, Node 115/115, native Debug/Release 각 2/2, 실제 브라우저 검사 통과 |
| 변경 전후 Wasm 공개 버퍼 비교 | 162개 시나리오·2,430개 체크포인트에서 14개 전체 버퍼가 비트 단위로 일치 |
| 변경 전후 native Debug 실행기 출력 비교 | 탐색 3종 × 개체 수 6종, 각 30스텝의 JSON 요약 출력 18개 일치. 전체 버퍼 비교와 구분 |
| 기존 native 병렬 검사 | 162개 시나리오의 직렬/병렬 전체 버퍼 비트 일치, 구간 중복·누락·완료 대기·워커 재사용·격리·종료 검사 통과 |
| `BOIDS_ENABLE_THREADS=OFF` 별도 Debug 빌드·CTest | 1/1 통과 |

Wasm은 31,566바이트로 재생성되었으며 외부 import 없음·고정 2 MiB·ABI v1 계약을 유지합니다.
기준선·비교 스크립트·결과는 로컬 `build/executor-clarity-20261107-222630/`에 보존합니다.
전체 검증의 로그·소스/런타임 fingerprint는 `artifacts/validation.json`과 연결된 로그에 기록합니다.
이후 VS Code 자동 저장 설정과 안내 문서만 추가로 수정했습니다. 설정 변경 후 `npm.cmd run check`를 다시 실행하여 서식·구조·원본/Wasm 연결과 Node 115/115 통과를 확인했습니다.
해당 설정의 검사는 전체 코어 실행 검증과 구분합니다.
EXE·VS Code 화면의 실시간 반영·성능 비교·스레드 sanitizer·독립 품질 점수 재평가는 이번 검증에 포함하지 않았습니다.
