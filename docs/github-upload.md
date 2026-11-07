# 공유 파일과 로컬 파일

[프로젝트 README](../README.md)

저장소에는 다른 개발자가 다운로드하여 실행·빌드·테스트하는 데 필요한 파일을 포함합니다.
추적 규칙은 [.gitignore](../.gitignore)에 정의하며 문서는 공유할 항목만 허용 목록으로 관리합니다.

## 저장소에 포함

| 대상 | 용도 |
| --- | --- |
| `native/`, `src/` | C++20·JavaScript 원본, C API, 화면과 스타일 |
| `tests/`, `tools/`, `.github/workflows/ci.yml` | 회귀 검사·빌드·개발 도구와 공개 CI |
| `desktop/` | Electron 진입점과 배포 자원 |
| `README.md`, `docs/`의 허용된 문서·이미지·측정 자료 | 실행법·알고리즘·코드 독해·설정 안내 |
| `package.json`, `package-lock.json`, `CMakeLists.txt`, `CMakePresets.json` | 의존성 잠금과 빌드 설정 |
| `.clang-format`, `.editorconfig`, `.prettier*`, `.gitattributes`, `.gitignore` | 공용 서식·줄바꿈·추적 설정 |
| `Boids-Lab.code-workspace`, `.vscode/{extensions,launch,settings,tasks}.json` | 상대 경로를 사용하는 공용 IDE 설정 |
| `index.html`, `styles.css`, `yoosh.html`, `dist/`, `wasm/`, `src/simulation/generated/` | ZIP 다운로드 후 실행과 SDK 없는 웹 빌드 |
| 번들에 포함된 외부 라이선스 고지 | Three.js·Emscripten 구성요소의 출처 |

생성 파일은 `npm.cmd run build` 또는 `npm.cmd run build:all`로 갱신합니다.
`dist/`, `wasm/`, `src/simulation/generated/`를 통째로 제외하면 실행 구성이 누락됩니다.

## 로컬에 보관

- SDK, `node_modules/`, `build/`, `artifacts/`, 실행 로그와 검사 캡처.
- 개인 PC 경로가 포함된 `CMakeUserPresets.json`, `.vscode/c_cpp_properties.json`, `*.local.code-workspace`.
- 자동화 도구의 개인 지침·작업 메모, 내부 평가·작업 보고서, 과거 전체 작업 사본.
- `.env`와 자격 증명, OS·IDE 캐시, 원본 과제 자료.
- `release/`의 패키징 중간 파일과 배포 산출물.

제외 규칙은 Git 추적 범위를 정하며 로컬 원본을 삭제하는 근거로 사용하지 않습니다.
이미 추적 중인 파일에는 `.gitignore`만 추가해도 적용되지 않으므로 실제 Git 목록을 확인합니다.

## Windows 배포 파일

검증한 EXE·SHA-256 체크섬·배포 manifest는 GitHub Releases의 같은 버전에 첨부합니다.
설치 의존성과 `release/win-unpacked/`는 소스 저장소에 포함하지 않습니다.
실행파일 생성과 검사는 [Windows 배포](desktop.md)를 확인합니다.

## 공개 파일 확인

```powershell
git status --short --untracked-files=all
git ls-files
git add --dry-run .
```

공개 대상만 새 폴더에 복사하고 `npm.cmd ci --ignore-scripts`, `npm.cmd run build`, `npm.cmd run check`를 실행합니다.
SDK와 C++ 도구·Chrome이 준비된 환경에서는 `npm.cmd run verify`로 전체 검사도 실행합니다.
로컬 검사와 원격 GitHub Actions 결과는 각각 확인합니다.
