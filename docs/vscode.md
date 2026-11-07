# VS Code 개발 환경

처음에는 루트의 `Boids-Lab.code-workspace`를 VS Code로 여십시오. `npm run dev:setup` 후에는 생성된 `Boids-Lab.local.code-workspace`를 열면 이 PC에서 탐지한 CMake 경로를 사용합니다. 파일 하나만 열지 말고 작업 영역 전체를 사용합니다. 현재 PC에 Microsoft C/C++와 CMake Tools 확장이 설치되어 있습니다. 다른 PC에서는 `.vscode/extensions.json`의 권장 확장을 설치합니다.

## 처음 설정

```powershell
npm ci --ignore-scripts
npm run dev:setup
```

Windows용 Visual Studio의 **C++를 사용한 데스크톱 개발** 구성 요소와 Node.js가 필요합니다. `dev:setup`은 `vswhere.exe`로 MSVC와 Visual Studio에 포함된 CMake를 찾아 IntelliSense와 CMake 작업 영역을 설정합니다. 시스템 PATH를 변경하거나 관리자 권한을 요구하지 않습니다. 다른 PC나 Visual Studio 업데이트 후 다시 실행하십시오.

Emscripten 4.0.23은 현재 `artifacts/emsdk`에 설치되어 있습니다. 앱용 WASM 재빌드에 사용합니다. 설치 절차는 [cpp-core.md](cpp-core.md)를 참조하십시오.

## 매일 사용하는 조작

| 조작 | 결과 |
| --- | --- |
| `Ctrl+Shift+B` | C++ → WASM → 개발용 웹 번들 빌드. 웹 번들은 소스 맵을 포함합니다. |
| `F5` → `C++: Simulation (Grid)` | 네이티브 Debug 빌드 후 MSVC 디버거로 실행합니다. 처음에는 `main`에서 멈춥니다. |
| `F5` → `C++: Simulation (KdTree)` | 같은 코어를 kd-tree 시나리오로 디버깅합니다. |
| `F5` → `Web: Three.js (Edge)` | 앱을 빌드하고 서버를 시작한 뒤 Edge에서 화면을 엽니다. |
| 작업 실행 → `Boids: Test core` | 실제 WASM을 사용하는 수치·메모리·진단 회귀 검사를 실행합니다. |
| 작업 실행 → `Boids: Test native C++` | 네이티브 클래스의 이웃 탐색 oracle·인스턴스 격리 검사를 실행합니다. |
| 작업 실행 → `Boids: Test browser` | 브라우저 조작·선택 검사를 실행합니다. |

C++ 프로필은 렌더러 없이 코어를 실행하는 디버그 실행기입니다. 브라우저에서 실행 중인 WASM에 C++ 디버거를 연결하는 구성은 아닙니다. 실제 화면과 UI 연동은 웹 프로필에서 확인합니다. 웹 프로필 종료 시 서버 디버그 세션도 종료하십시오. 4173 포트가 이미 사용 중이면 기존 서버를 종료하거나 `launch.json`의 `env.PORT`를 다른 값으로 지정합니다.

## 중단점 위치

- `tests/native/DebugRunner.cpp`: 시나리오 설정과 `boids_step()` 호출.
- `native/bindings/Simulation.cpp`: `FSimulation::Step`, `Reset`과 전체 갱신 순서.
- `native/src/simulation/BirdFlock.cpp`: `FBirdFlock::IntegrateNextVelocities`, `CommitVelocitiesAndIntegratePositions`, `CalculateMetrics`.
- `native/src/simulation/KdTree.cpp`: `FKdTree::BuildBranch`, `FKdTree::QueryCandidates`.
- `native/src/simulation/SpatialGrid.cpp`: `FSpatialGrid::Rebuild`, `FSpatialGrid::QueryCandidates`.
- `native/src/simulation/Goal.cpp`, `Predator.cpp`: `FGoal::Update`, `FPredator::Update`.
- `native/src/simulation/BirdFlock.cpp`: `CollectNeighborhood`, `BuildFlockingResult`의 인지 반경·시야각·군집 조향 계산.

- `native/src/simulation/BirdVectorBuffer.h`: `GetVector`, `SetVector`, `GetComponent`, `CopyFrom`의 개체 인덱스/축 접근과 float 저장 경계.
- `native/src/simulation/NeighborSearch.cpp`: `QueryCandidates`와 후보 vector의 size/capacity, 조회 순서.
- `native/bindings/SimulationAbi.cpp`, `SimulationState.h/.cpp`: 설정·상태 스냅샷과 `FSimulationState` 값 전이, 작업별 선택적 publication.
- `native/src/collision/ObstacleSet.cpp`: `Synchronize`의 형상 재사용·교체·축소 소멸.
- `src/simulation/core-bridge.js`: 웹 디버그의 ABI 슬롯 매핑·typed array 생성·속도 역할 조회.

현재 변수는 `Context.ActiveBirdCount`, `State.SimulationTime`, `State.GoalPhaseTime`, `Config.PerceptionRadius`처럼 확인합니다. 위치는 버퍼 객체이며 계산 접근은 BirdIndex/EAxis를 사용합니다. 후보는 const vector 참조, Search는 unique_ptr이므로 이전 raw 배열/offset·값 객체 전제의 watch 표현식을 그대로 쓰지 않습니다. 이전 줄 번호에 남은 중단점은 최신 함수 정의로 다시 지정하십시오. ABI 데이터는 GetAbiData/GetAbiBuffer 경계에서 확인하고 디버거 평가로 저장소를 resize하지 않습니다.

`F9`로 중단점을 설정하고 `F10` 단계 실행, `F11` 함수 진입, `Shift+F5` 종료를 사용합니다. 시나리오의 개체 수·스텝 수·시드는 `launch.json`의 `args`에서 변경합니다.

```powershell
# 터미널에서도 같은 실행기를 사용합니다.
npm run dev:run -- --search kd-tree --count 320 --steps 180 --seed 7
npm run test:native
```

## 파일 표시와 설정

이 프로젝트는 `files.autoSave: afterDelay`, `files.autoSaveDelay: 500`을 사용합니다.
VS Code에서 편집한 내용은 입력을 멈춘 뒤 500ms 후 자동 저장합니다.
자동 저장은 편집기 내용을 디스크에 쓰는 기능이며, 외부 도구가 저장한 파일을 읽는 변경 감지와는 별개입니다.
`native/`, `src/`, `tests/`, `tools/`는 파일 감시에서 제외하지 않습니다.
외부 변경과 미저장 편집이 충돌하면 자동 덮어쓰기 대신 충돌을 해결해야 합니다.
설정 변경은 현재 작업 폴더에 적용됩니다. [공식 자동 저장 설명](https://code.visualstudio.com/docs/editing/codebasics#_save-auto-save)을 참조하십시오.

`node_modules`, `artifacts`, `build`, 생성된 코어는 탐색기/검색에서 제외합니다. 삭제한 것이 아니므로 VS Code 설정에서 `files.exclude`를 끄거나 파일 탐색기에서 확인할 수 있습니다. 실제 수정 대상은 `native/`, `src/`, `tests/`, `tools/`입니다.

`npm run dev:setup`은 컴파일러 경로를 `.vscode/c_cpp_properties.json`, CMake 경로를 `Boids-Lab.local.code-workspace`에 기록합니다. 두 파일은 Git에서 제외한 PC별 생성물입니다. 추적하는 `Boids-Lab.code-workspace`와 `.vscode/settings.json`은 변경하지 않습니다. 다른 PC나 Visual Studio 업데이트 후 명령을 다시 실행하면 로컬 경로만 갱신합니다. `.clang-format`은 C++20·탭 폭 4·Allman 기준이며 함수 인자와 선언·대입·계산·조건식을 한 줄에 유지합니다. C/C++ 확장의 포맷 명령으로 적용합니다. C++ 편집기의 자동 줄바꿈도 끕니다.

`npm run test:vscode`는 별도 extension host에서 Step 중단점과 변수 조회·한 줄 실행을 검사합니다. 중단점은 현재 함수 정의에 지정합니다. 실행 범위는 [검증 방법](verification.md), 타입·수명 계약은 [프로젝트 규칙](cpp-project-rules.md)을 확인합니다.

공식 참고: [C++ IntelliSense](https://code.visualstudio.com/docs/cpp/configure-intellisense), [C++ 디버그 구성](https://code.visualstudio.com/docs/cpp/launch-json-reference), [VS Code 작업](https://code.visualstudio.com/docs/debugtest/tasks).
