# C++ 프로젝트 규칙

현재 C++ 코어의 이름·서식·상태 소유·ABI·수명 계약을 설명합니다. 전체 책임은 [아키텍처](architecture.md), 빌드와 실행 검사는 [C++/Wasm 개발](cpp-core.md)과 [검증 방법](verification.md)을 확인합니다.

## 이름과 파일

- 언리얼 소스 기반 [C++ 코딩 표준](cpp-coding-standard.md)을 적용합니다. 일반 class/struct는 F, 템플릿 타입은 T, enum class는 E 접두를 사용합니다. 함수·멤버·인자·지역 변수는 PascalCase, bool은 b, 출력 인자는 Out, 기존 값을 누적 수정하는 인자는 InOut 접두를 사용합니다. 주요 C++ 타입은 전역에 선언하고, 상수와 구현 보조 함수는 각각 `constants`, `detail` 네임스페이스에 둡니다.
- 클래스 파일은 타입 접두를 제외한 PascalCase로 맞춥니다. FBirdFlock 선언은 BirdFlock.h, 모든 구현은 BirdFlock.cpp 한 파일에 둡니다. Axis/WorldBounds 등 값 타입과 SimulationConfig/SimulationState 클래스 파일도 같은 이름 규칙을 적용합니다.
- 공개 C ABI 함수·원 Config/State enum·selector·배열 타입/길이·ABI v1은 유지합니다. 공개 `native/bindings/include/boids/boids.h`와 실행 진입점 `tests/native/DebugRunner.cpp`·테스트 파일명은 예외입니다.
- include·CMake·core source/hash 목록·디버거·문서의 경로 대소문자를 실파일과 일치시킵니다. 과거 baseline/실험 snapshot을 개명하지 않습니다.

## 배치와 가독성

`.clang-format`을 기준으로 Allman, 탭 폭 4의 탭 들여쓰기, 이어지는 줄 4칸, 괄호/연산자 DontAlign을 사용합니다. `IndentAccessModifiers: false`, `AccessModifierOffset: -4`로 public/private는 class와 같은 단계에, 멤버는 한 단계 안에 둡니다. 전체 cpp/h에 동일하게 적용하며 공개 ABI 헤더는 서식 변경 후 원 선언/enum 토큰을 비교합니다. 일반 변수·반환값에는 명시적인 타입을 사용하고, 타입을 직접 적을 수 없는 람다·읽기 어려운 반복자·종속 템플릿 표현식에만 auto를 허용합니다.

공개 인터페이스를 먼저 배치하고 class마다 책임·상태 소유 또는 수명을 한글 최대 5줄로 설명합니다. 함수는 호출 흐름에서 처리 단계가 드러나게 작성합니다. 복잡한 식에는 의도 있는 이름을 붙이고 한 줄 다중 선언·중첩 삼항식·의미 없는 빈 줄을 피합니다. helper는 독립된 의미가 있을 때만 추출하며 줄 수 제한을 맞추기 위해 분해하지 않습니다. 주석은 코드 반복보다 이유와 계약을 설명합니다.

## 상태 소유와 ABI 경계

FSimulation은 전체 갱신 순서, 설정 스냅샷, FSimulationAbi, FObstacleSet, FBirdFlock, FGoal, FPredator를 관리합니다. Bird는 보이드 배열·속도 역할·RNG·진단·검색과 군집/적분/충돌/경계를 실제로 소유합니다. actor는 자기 float 저장 상태와 그 상태를 사용하는 동작을 소유합니다.

RawConfig/RawState/RawObstacleRecords와 원 enum 변환은 FSimulationAbi만 소유합니다. domain은 FSimulationConfig와 FSimulationState의 이름 있는 값을 사용합니다. FSimulationConfig는 IsSoftBoundary/UsesBoundarySteering 정책을, FSimulationState는 ResetForBirdCount/AdvanceTime/SnapGoalInterpolation/SetFlockMetrics 전이를 담당합니다. 과거 FSimulationStateView의 double& 연결과 파일은 사용하지 않습니다.

계산 public entry의 RefreshInputsFromAbi에서 ReadConfigSnapshot/ReadStateSnapshot/ReadObstacleSnapshot을 한 번 수행합니다. 시작에는 외부 ABI 값이 입력 원천이며 내부 단계에서는 가져온 값과 진행 중인 상태를 사용합니다. 종료 시 Reset은 State 0~9, Step은 1~9, SnapInterpolation은 3/4, 통계 갱신과 활성 장애물 보정은 6~9만 기록합니다. 나머지 계산 entry와 비활성 장애물 보정은 State를 쓰지 않습니다. 출력 대상이 아닌 슬롯은 값이 같아도 다시 쓰지 않습니다. 내부 helper 재import와 무조건 전체 export는 금지합니다. GetAbiBuffer는 import/계산 없는 대여입니다.

FFlockContext는 FSimulationConfig/ObstacleSet/Goal/Predator const 참조와 State.ActiveBirdCount에서 얻은 ActiveBirdCount를 호출 동안만 빌립니다. RequestedBirdCount는 Reset에서만 활성 수에 적용합니다. 영속 context 또는 mutable buffer view 캐시를 만들지 않습니다. 속도 selector 4/5는 현재 역할을 매번 조회합니다.

JS는 boids.js의 입력 검증·서비스와 core-bridge.js의 BoidsCoreBridge를 구분합니다. bridge는 WASM 인스턴스·ABI 슬롯 매핑·설정/장애물 포장·typed array·계측·속도 역할을 맡습니다. C++ FSimulationAbi와 JS bridge에 숫자 배치 변환을 모으되 양쪽 공개 ABI v1을 유지합니다.

## 초기 할당과 고정 수명

Bird의 위치·이전 위치·속도 A/B는 BirdVectorBuffer.h의 FBirdVectorBuffer로 소유합니다. 이 클래스는 private std::vector<float>를 기본 생성자에서 MaxBirdCount×AxisCount개의 0 원소로 초기화하며 복사·이동을 금지합니다. GetVector/SetVector/GetComponent/CopyFrom/GetBirdCapacity/GetAbiData로 접근을 제한합니다. 과거 std::array 별칭과 BirdBufferTypes.h는 사용하지 않으며 현재 FBirdVectorBuffer는 저장소를 캡슐화한 클래스입니다. 이웃 수·이웃 인덱스·inspection vector도 생성 시 최대 개체 수에 맞춰 초기화합니다.

Bird/Predator/Grid/Tree 도메인 입력은 const FBirdVectorBuffer&와 BirdIndex/EAxis를 사용합니다. flat 배치와 offset 산술은 버퍼 구현에 숨기고 GetAbiData의 raw 포인터는 ABI 연결에서만 대여합니다. 값 읽기/쓰기로 기존 double 계산·float 저장 지점을 바꾸지 않습니다. CopyFrom은 전체 스냅샷을 기존 저장소에 복사합니다.

FBirdFlock은 FNeighborSearch를 unique_ptr로 단독 소유하고 make_unique로 생성 시 할당합니다. Grid/Tree 내부 공간 인덱스는 고정 std::array를 유지합니다. Tree의 SplitCoordinateByNode는 Rebuild마다 활성 노드의 분할 좌표를 float로 저장하는 캐시이며 이후 조회에서 같은 값을 읽습니다. FNeighborSearch 후보 scratch는 std::vector<int>이며 생성 시 reserve(MaxBirdCount)를 보장합니다. FNeighborCandidates는 제거하고 QueryCandidates가 const std::vector<int>&를 반환합니다. 호출자는 const std::vector<int>&로 받아 복사를 피하며 다음 Rebuild/QueryCandidates가 내용을 덮어쓸 수 있음을 지킵니다.

Grid/Tree는 출력 vector를 clear/push_back하고 all-pairs는 Rebuild마다 활성 수로 resize한 뒤 iota로 채웁니다. 후보 scratch의 예약 용량 안에서 size를 바꾸는 것은 허용합니다. 하위 QueryCandidates에 용량이 부족한 vector를 넘기면 할당될 수 있으므로 production FNeighborSearch의 사전 reserve와 최대 후보 수 보장으로 생성 이후 추가 할당 0을 검증합니다.

위치·속도·ABI 진단 저장소는 생성 이후 resize/reserve/shrink_to_fit·크기 변경·추가 할당을 하지 않습니다. ABI data 주소와 길이는 인스턴스 생존 중 고정입니다. 현재/다음 속도는 FBirdVectorBuffer* 역할 포인터만 기존 단계에서 한 번 swap하고 홀수 스텝 뒤 Reset에서도 역할을 유지합니다. 소유 객체/저장소를 이동·교체하지 않으며 Bird/상위 객체의 복사·이동 금지도 유지합니다.

WASM은 emmalloc을 사용하며 기존 MALLOC=none을 현재 규칙으로 적용하지 않습니다. 초기 메모리 2 MiB·성장 금지·실제 무 import·예외/RTTI 비활성을 검증합니다. 생성 시 할당 비용과 스텝 비용을 분리합니다. sizeof(FBirdFlock) 감소는 본체의 inline 저장 감소이며 전체 메모리 감소를 뜻하지 않습니다. vector 요소·검색 객체·allocator 비용은 별도로 측정합니다.

## 계산과 저장

- FVector3D는 double 계산, FVector3f의 실제 float Components 배열과 Bird flat float 배열은 float32 저장입니다. struct XYZ를 float 포인터로 재해석하거나 union으로 ABI 배열을 만들지 않습니다.
- 벡터 산술/복합 연산자는 성분 계산을 명료하게 표현하는 용도입니다. 나눗셈은 성분별 직접 division이며 역수 곱셈으로 바꾸지 않습니다. 기존 덧셈·곱셈·누적 순서, hypot, float 저장 위치를 보존합니다. 0부터 +=하는 누적을 Dot으로 자동 치환하지 않습니다.
- 축은 EAxis/AllAxes/ToIndex, 경계 크기는 const FWorldBounds&로 표현합니다. X/Y/Z, 격자 z/y/x, 후보·충돌·축 판정 순서는 각각 기존 계약을 유지합니다.
- 물리·힘·거리·배열 배치 숫자는 SimulationConstants.h의 의미 있는 상수로 표현하고 원래 리터럴 타입/값을 유지합니다. 항등값·원 난수 알고리즘 상수 등은 설명 있는 예외를 허용합니다.

## 장애물 다형성의 제한

FObstacle은 GetShape/Configure/CalculateSignedDistance/GetAvoidanceFalloffLength를 형상별로 구현하며 Center와 Radius/Dimensions는 각 객체의 typed 상태입니다. FObstacleSet은 reserve(MaxObstacles)한 vector<unique_ptr<FObstacle>>를 소유하고 vector.size가 활성 수입니다. 원 raw 기록 16×8은 FSimulationAbi가 소유하며 FObstacleDescriptorSnapshot으로 전달합니다. 같은 Count에서도 Synchronize로 편집을 반영하고 raw/tail을 덮어쓰지 않습니다.

동일 형상은 기존 객체에 Configure하여 위치/크기를 갱신합니다. 최초 활성화·종류 교체·축소/재활성화는 객체 생성/해제를 허용하며 같은 형상의 편집과 입력이 그대로인 정상 스텝은 추가 할당하지 않습니다. 편집 후 첫 Step에서도 입력 동기화 할당이 발생할 수 있으므로 모든 Step을 무할당으로 표현하지 않습니다. GetObstacle의 참조는 형상 교체·해당 슬롯 제거·소유자 파괴 때 무효입니다. 활성 범위 밖 조회와 참조의 장기 보관을 금지합니다.

GetAvoidanceFalloffLength는 구에서 Radius + 기준값, 박스에서 기준값을 반환합니다. CalculateSignedDistance의 부호 있는 거리와 구분하며 기본 0 크기도 유한하게 정의합니다. unique_ptr<FObstacle>가 base를 통해 삭제하므로 소멸자는 public virtual ~FObstacle() = default입니다. [C++ Core Guidelines C.35](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#Rc-dtor-virtual)와 [R.20](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#Rr-owner)에 따라 삭제 계약과 단독 소유를 표현합니다. RTTI와 공유 소유권을 도입하지 않으며 장애물 외의 Bird/탐색/actor에 가상 계층을 확대하지 않습니다.

## 검증과 증거

생성 시 크기를 확정한 vector와 고정 검색 저장과 ABI 배열의 용량·주소 안정성·전체 이전 위치 복사·이전 속도 일괄 읽기 후 한 번 swap·홀수 스텝 뒤 Reset 역할·RNG 호출·수치 순서를 유지합니다. 이전 판 결과는 새 소스의 검증을 대신하지 않습니다. 버퍼 클래스/vector 후보 API 및 분할 좌표 캐시를 적용한 최신 판은 이전 단계의 기록과 구분합니다. sizeof는 본체 크기만 설명하며 전체 메모리 사용량으로 표현하지 않습니다. 초기화·정상 실행·같은 형상 편집·종류 교체·축소/재활성화의 할당/해제를 구별하고 data 주소/길이, 속도 역할 및 sizeof/실제 저장 비용도 확인합니다. 새 파일과 삭제 파일을 build/source 목록에 반영한 뒤 전체 재빌드·source hash·수치/메모리·native·browser 검사를 수행합니다. -fno-rtti/-fno-exceptions와 실제 WASM import 목록도 확인합니다.

성능은 동일한 환경·입력·실행 횟수로 측정하고 변동 폭과 측정 범위를 함께 기록합니다. 수치 회귀 통과와 성능 개선은 별도로 판단합니다. 측정 조건과 지표는 [성능 문서](performance.md)를 확인합니다.
