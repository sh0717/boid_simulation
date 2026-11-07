#pragma once
#include <cstdint>
#if defined(__EMSCRIPTEN__)
#include <emscripten/emscripten.h>
#define BOIDS_API EMSCRIPTEN_KEEPALIVE
#else
#define BOIDS_API
#endif

// ABI v1: Wasm 인스턴스 하나가 고정 메모리의 시뮬레이션 하나를 소유합니다.
// 위치·속도 저장은 float32, 규칙 계산·설정·시간은 float64입니다.
namespace boids
{
	constexpr int Capacity = 1200;
	constexpr int MaxObstacles = 16;

	enum Config
	{
		Count,
		Cohesion,
		Alignment,
		Separation,
		Perception,
		FieldOfView,
		GoalEnabled,
		GoalSpeed,
		GoalStrength,
		PredatorEnabled,
		PredatorSpeed,
		PredatorRadius,
		PredatorStrength,
		ObstaclesEnabled,
		BoundaryMode,
		BoundaryMargin,
		BoundaryStrength,
		SearchType,
		HalfX,
		HalfY,
		HalfZ,
		CellSize,
		ObstacleCount,
		ConfigSize
	};

	enum State
	{
		ActiveCount,
		Time,
		GoalTime,
		PreviousGoalTime,
		GoalAdvance,
		NeighborChecks,
		MeanSpeed,
		Order,
		OutsideCount,
		MaxExcursion,
		StateSize
	};

	// Selector -> element type, capacity (active prefix only unless stated):
	// 0 config:f64[23], 1 state:f64[10], 2/3 position/previous:f32[1200*3],
	// 4/5 velocity/next:f32[1200*3], 6 visible counts:u16[1200],
	// 7 goal,8 predator,9 previous predator,10 predator velocity:f32[3],
	// 11 obstacles:f64[16*8], 12 inspection:f64[11],13 neighbor IDs:u16[1200].
	enum class ECoreBuffer : int
	{
		Config = 0,
		State = 1,
		Positions = 2,
		PreviousPositions = 3,
		Velocities = 4,
		NextVelocities = 5,
		NeighborCounts = 6,
		Goal = 7,
		Predator = 8,
		PreviousPredator = 9,
		PredatorVelocity = 10,
		Obstacles = 11,
		Inspection = 12,
		Neighbors = 13
	};

	// Config: booleans are exactly 0/1; boundary=0 hard/1 soft/2 hybrid;
	// search=0 grid/1 kd-tree. Count is an integer 1..Capacity, obstacle count
	// is 0..MaxObstacles. Half extents/cell size are positive and finite, and
	// ceil(2*HalfX/CellSize)*ceil(2*HalfY/CellSize)*ceil(2*HalfZ/CellSize)<=8000.
	// Other settings follow src/config.js SETTING_RANGES (FOV is degrees).
	// Position/distance use scene units; time and dt use seconds; speed is units/s.
	// Obstacles: type (0 sphere,1 box),x,y,z,radius,width,height,depth; dimensions
	// are positive, finite and fit the world with the adapter's clearance policy.
	// Inspection: neighborCount,closeCount,cohesion xyz,alignment xyz,separation xyz.
	// Only the first neighborCount neighbor IDs are valid after boids_inspect().
	// Output state slots are core-written; host may set GoalTime for phase seeking.
	// reset writes all slots; step writes all except ActiveCount; snap writes
	// PreviousGoalTime/GoalAdvance; measure writes MeanSpeed/Order/OutsideCount/MaxExcursion.
} // namespace boids

// ABI 경계: JS 어댑터가 설정 범위·배열 배치·dt를 검증한 뒤 호출합니다.
// 반환 배열은 WASM 인스턴스가 소유하며 외부에서 해제하거나 크기를 바꾸지 않습니다.
// 속도 버퍼 역할은 스텝마다 바뀔 수 있으므로 boids_buffer(4/5)로 다시 조회합니다.
// 이 raw ABI는 검증을 반복하지 않는 trusted boundary입니다. NaN, 범위 초과,
// 잘못된 활성 개수/index/dt와 직접 배열 변조는 계약 위반입니다. 사용자 입력은
// BoidSimulation이 의미/범위, BoidsCoreBridge가 저장소 배치를 검증한 후 호출합니다.
// 모든 버퍼의 주소와 Wasm memory.buffer는 인스턴스 수명 동안 고정됩니다.
// 내용은 호출마다 변경되며 대여 뷰를 보관해도 다음 step의 이전 상태는 보존되지 않습니다.
// JS dispose는 인스턴스 참조를 놓습니다. 이미 대여한 TypedArray는 메모리를 계속 보유할
// 수 있으므로 GC 전 즉시 해제를 약속하지 않으며, 종료 후 사용은 지원하지 않습니다.
extern "C"
{
	// ABI 경계: 어댑터가 기대하는 버전과 호환되는지 확인합니다.
	BOIDS_API int boids_abi_version();

	// 슬롯 번호·selector·원소 크기·용량의 FNV-1a word signature. 읽기만 수행합니다.
	BOIDS_API std::uint32_t boids_abi_schema();

	// ABI 경계: selector의 연속 버퍼를 빌려줍니다. 잘못된 selector는 nullptr입니다.
	BOIDS_API void* boids_buffer(int selector);

	// ABI 경계: 입력 설정과 seed로 활성 개체를 초기화합니다.
	BOIDS_API void boids_reset(std::uint32_t seed);

	// ABI 경계: 검증된 dt로 한 스텝을 진행하고 출력 상태와 속도 역할을 갱신합니다.
	BOIDS_API void boids_step(double dt);

	// ABI 경계: 현재 위상의 목표 위치를 출력 버퍼에 갱신합니다.
	BOIDS_API void boids_goal();

	// ABI 경계: 현재 상태로 표시 보간의 이전 상태를 맞춥니다.
	BOIDS_API void boids_snap();

	// ABI 경계: 현재 군집 통계를 상태 버퍼에 기록합니다.
	BOIDS_API void boids_measure();

	// ABI 경계: 입력 설정과 현재 위치로 이웃 후보 탐색을 재구축합니다.
	BOIDS_API void boids_rebuild();

	// ABI 경계: 포식자 위치·속도와 이전 위치를 갱신합니다.
	BOIDS_API void boids_predator(double dt);

	// ABI 경계: 편집된 장애물에 맞춰 군집 위치·속도·보간 상태를 보정합니다.
	BOIDS_API void boids_reconcile_obstacles();

	// ABI 경계: 경계 모드에 따라 군집과 포식자를 변경된 맵 안으로 보정합니다.
	BOIDS_API void boids_reconcile_bounds();

	// ABI 경계: 검증된 활성 개체 index의 진단 값과 이웃 인덱스를 출력합니다.
	BOIDS_API void boids_inspect(int index);

	// ABI 경계: 활성 개체의 가시 이웃 수를 진단 버퍼에 갱신합니다.
	BOIDS_API void boids_refresh_neighbors();
}
