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
