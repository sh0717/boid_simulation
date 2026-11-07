# Boids C++ 코드 리뷰 안내

공개 입력이 군집 상태 갱신과 ABI 출력으로 이어지는 경로를 약 25분 안에 읽는 안내입니다.
파일 배치는 [native 구조](native-layout.md), 명명·서식은 [C++ 표준](cpp-coding-standard.md)을 따릅니다.
고정 줄 번호 대신 아래 파일과 함수 이름으로 이동하십시오.

## 25분 읽기 순서

| 시간 | 파일·함수 | 확인할 내용 |
| --- | --- | --- |
| 0–4분 | [boids.h](../native/bindings/include/boids/boids.h)의 `ECoreBuffer`, `boids_buffer`·`boids_step`; [Bindings.cpp](../native/bindings/Bindings.cpp) | C ABI 슬롯·자료형·활성 구간과 호출 전제, 실제 위임 대상 |
| 4–9분 | [Simulation.cpp](../native/bindings/Simulation.cpp)의 `FSimulation::RefreshInputsFromAbi`, `Step` | 입력 스냅샷 → 목표·포식자 → 이웃 검색 → 군집 갱신 → 출력 발행 순서 |
| 9–16분 | [BirdFlock.h](../native/src/simulation/BirdFlock.h)의 `FBirdFlockBuffers`, `FBirdFlock`; [BirdFlock.cpp](../native/src/simulation/BirdFlock.cpp)의 `CollectNeighborhood`, `IntegrateNextVelocities`, `CommitVelocitiesAndIntegratePositions` | 상태 소유·버퍼 대여·현재/다음 속도 분리, 분리 힘과 시야 필터 순서 |
| 16–21분 | [NeighborSearch.cpp](../native/src/simulation/NeighborSearch.cpp)의 `QueryCandidates`; [SpatialGrid.cpp](../native/src/simulation/SpatialGrid.cpp)의 `GetCellCoordinate`, `GetCellDistanceLowerBound`; [KdTree.cpp](../native/src/simulation/KdTree.cpp)의 `QueryCandidates` | 후보와 실제 이웃의 차이, 후보 순서, Soft 경계 끝 셀과 탐색 가지치기 |
| 21–25분 | [BirdFlock.cpp](../native/src/simulation/BirdFlock.cpp)의 `ResolveObstacles`, `SelectBoundaryTangentAxis`; [Predator.cpp](../native/src/simulation/Predator.cpp)의 `LimitSpeedAndIntegratePosition` | 투영·반사·속도 제한의 적용 지점, 축 동률 우선순위와 float 저장 시점 |

## 처리 흐름과 데이터 소유

`FSimulation::Step`의 주요 순서는 다음과 같습니다. 군집 갱신 후 거리 검사 횟수 기록과 최종 상태 슬롯 발행도
같은 함수에서 확인하십시오.

```text
입력 스냅샷 읽기 → 이전 위치 보관 → 시간 진행 → 목표·포식자 갱신
  → 현재 위치로 이웃 검색 재구축
  → 모든 개체의 다음 속도 계산
  → 속도 버퍼 역할 교체 → 위치 적분·장애물·경계 보정
  → 군집 통계 계산 → ABI 상태 발행
```

`FBirdFlock`은 위치·속도·진단 저장소와 `FNeighborSearch`를 소유합니다. `FFlockContext`의 설정·장애물·actor는
호출 동안만 빌립니다. `FBirdFlockBuffers`의 포인터도 소유권을 넘기는 값이 아닙니다.
버퍼 저장소 주소는 고정되지만 현재/다음 속도의 **역할**은 커밋에서 바뀌므로 호출자는 다시 조회해야 합니다.
[core-bridge.js](../src/simulation/core-bridge.js)의 `BoidsCoreBridge`와
[boids.js](../src/simulation/boids.js)의 `BoidSimulation.step`에서 이 소비 경로를 이어 읽으십시오.

## 보존해야 할 계약

- **입력 경계와 ABI:** raw C ABI는 검증된 입력을 전제로 합니다. 사용자 입력 검증은 `BoidSimulation`과
  `BoidsCoreBridge`가 수행합니다. ABI v1의 슬롯·export·원소 폭을 바꾸지 않습니다.
  Wasm은 고정 2 MiB, 외부 import 없음, C++ 예외·RTTI 비활성 계약을 유지합니다.
- **한 스텝의 읽기/쓰기:** 이웃 힘 계산은 모든 개체가 기존 속도를 읽은 뒤 완료합니다.
  `IntegrateNextVelocities` 중에 현재 속도를 바꾸거나 개체마다 버퍼를 교체하면 결과가 달라집니다.
- **누적·난수 순서:** `CollectNeighborhood`는 분리 힘을 FOV 판정보다 먼저 누적합니다.
  탐색 후보 순서, `(Separation + Cohesion) + Alignment`의 결합, `RandomValue`의 uint32 연산과
  `Reset`의 축별 난수 호출 순서를 유지합니다.
- **공간·접촉 처리:** 탐색기는 후보만 제공합니다. 정확한 거리·시야 검사는 군집 계층의 책임입니다.
  `ResolveObstacles`는 각 장애물마다 투영 → 속도 반사 → 속도 제한을 완료하고 다음 장애물을 처리합니다.
  `SelectBoundaryTangentAxis`의 동률 X→Y→Z와 경계의 작은 힘 조기 반환도 보존합니다.
- **수명과 저장 정밀도:** 군집 버퍼 크기·복사/이동 금지와 대여 뷰의 수명은 선언에서 확인합니다.
  `FPredator::LimitSpeedAndIntegratePosition`은 축별 속도를 float로 저장한 뒤 그 값으로 위치를 적분합니다.
  계산을 합치거나 저장을 뒤로 미루는 변경은 별도 수치 비교가 필요합니다.

## 리뷰 질문 5개

1. 입력 검증을 수행하는 JS 경계와 검증된 버퍼를 읽는 C ABI를 구별할 수 있습니까?
2. 모든 개체가 이전 속도를 읽는 동안 `NextVelocities`에만 쓰며, 커밋 후 속도 역할을 다시 조회합니까?
3. 분리 힘·FOV·후보 순서·난수 호출·힘의 괄호가 기존 결과에 미치는 영향을 설명할 수 있습니까?
4. 장애물별 보정 순서, 접선 축 동률, Soft 끝 셀의 거리 하한과 float 저장 시점이 유지됩니까?
5. 변수명·함수 분리 변경의 소스 비교 근거와 현재 소스로 다시 실행한 검사 근거를 함께 제시했습니까?

## 검사와 근거 읽기

프로젝트 루트에서 실행합니다. C++ 변경 후에는 Emscripten 4.0.23으로 먼저 재빌드하여
현재 원본과 배포 Wasm의 해시를 일치시킵니다.

```powershell
npm.cmd run build:all
npm.cmd run check
npm.cmd run test:native
npm.cmd run test:native:release
npm.cmd run test:browser
```

`check`는 서식·폴더/의존 방향·원본/Wasm 연결과 Node 회귀를 확인합니다. 수치 보존은 같은 시드·설정·명령을
변경 전후 런타임에 재생하여 별도로 비교해야 합니다.

관련 테스트를 읽을 때는 [core-tests.cpp](../tests/native/core-tests.cpp)의 native 계약,
[abi-schema.test.js](../tests/unit/abi-schema.test.js)의 슬롯·자료형,
[cpp-core.test.js](../tests/unit/cpp-core.test.js)의 실제 코어,
[boundary.test.js](../tests/unit/boundary.test.js)와 [obstacles.test.js](../tests/unit/obstacles.test.js)의
경계·장애물 기대 동작을 확인하십시오.

검사 결과는 실행 명령·종료 코드·대상 소스와 함께 확인합니다. 전체 실행법은 [검증 방법](verification.md)을 따릅니다.
