#pragma once
#include "collision/ObstacleDescriptor.h"
#include "core/SimulationConfig.h"
#include "core/SimulationConstants.h"
#include "simulation/SimulationState.h"
#include <array>
#include <boids/boids.h>

// C ABI의 설정·상태·장애물 원본 배열을 고정 주소로 소유합니다.
// 도메인 값과 원본 배열을 분리하고 연산별로 지정된 상태 슬롯만 반영합니다.
// ABI 대여 주소를 유지하기 위해 복사·이동을 금지합니다.
class FSimulationAbi
{
public:
	FSimulationAbi() = default;

	FSimulationAbi(const FSimulationAbi&) = delete;

	FSimulationAbi& operator=(const FSimulationAbi&) = delete;

	FSimulationAbi(FSimulationAbi&&) = delete;

	FSimulationAbi& operator=(FSimulationAbi&&) = delete;

	// ABI 경계: 호출자가 검증한 원본을 읽어 독립된 도메인 값을 반환합니다.
	/** 설정 슬롯을 계산용 값 타입으로 변환합니다. 원본 배열의 유효성은 호출자가 보장합니다. */
	[[nodiscard]] FSimulationConfig ReadConfigSnapshot() const;

	/** 검증된 이웃 수 상한을 저장합니다. 0은 제한 없음을 의미합니다. */
	void SetMaximumNeighborCount(int RequestedMaximumNeighborCount);

	/** 상태 슬롯을 독립된 도메인 상태로 복사합니다. */
	[[nodiscard]] FSimulationState ReadStateSnapshot() const;

	// 활성 수는 검증된 0~MaxObstacles이며 활성 레코드만 해석하고 원본을 변경하지 않습니다.
	[[nodiscard]] FObstacleDescriptorSnapshot ReadObstacleSnapshot(int ActiveObstacleCount) const;

	// ABI 경계: 이름에 해당하는 출력 슬롯만 쓰며 그 밖의 외부 입력은 보존합니다.
	// Reset은 10개, Step은 활성 수 제외 9개, 보간은 이전 위상·진행량, 통계는 4개입니다.
	/** 활성 개체 수를 포함한 전체 상태 슬롯을 기록합니다. */
	void PublishResetState(const FSimulationState& State);

	/** 활성 개체 수를 보존하고 시간·목표 위상·검사 횟수·군집 통계를 기록합니다. */
	void PublishStepState(const FSimulationState& State);

	/** 목표의 이전 위상과 이번 위상 진행량만 기록합니다. */
	void PublishGoalInterpolationState(const FSimulationState& State);

	/** 평균 속력·방향 정렬도·경계 이탈 개수·최대 이탈량만 기록합니다. */
	void PublishFlockMetrics(const FSimulationState& State);

	// ABI 경계: 각각 ConfigSize/StateSize개 double을 빌려줍니다.
	// 소유권을 넘기지 않으며 주소는 이 객체가 생존하는 동안 고정됩니다.
	double* GetConfigAbiData();

	const double* GetConfigAbiData() const;

	double* GetStateAbiData();

	const double* GetStateAbiData() const;

	// ABI 경계: MaxObstacles×ObstacleStride개 double 원본이며 대여 수명은 이 객체에 종속됩니다.
	double* GetObstacleRecordsAbiData();

	const double* GetObstacleRecordsAbiData() const;

private:
	/** Hard·Soft 값을 해석하고 나머지는 Hybrid로 매핑합니다. 범위 검증은 외부 계약입니다. */
	static EBoundaryMode DecodeBoundaryMode(double RawMode);

	/** KdTree·AllPairs 값을 해석하고 나머지는 Grid로 매핑합니다. */
	static ESearchMethod DecodeSearchMethod(double RawMethod);

	// 외부에 빌려주는 원본 배열입니다. 도메인 스냅샷과 자동으로 동기화되지 않습니다.
	std::array<double, ConfigSize> RawConfig{};

	std::array<double, StateSize> RawState{};

	std::array<double, MaxObstacles * constants::ObstacleStride> RawObstacleRecords{};

	int MaximumNeighborCount = 0;
};
