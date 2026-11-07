#pragma once
#include "core/WorldBounds.h"
#include "simulation/BirdVectorBuffer.h"

// 포식자의 현재·이전 위치와 속도 버퍼를 소유하고 추적·회피·경계 동작을 담당합니다.
// 개체 위치와 설정은 호출 동안만 빌리며 멤버에 보관하지 않습니다.
class FPredator
{
public:
	/**
	 * 월드 크기에 비례한 생성 위치와 MaxSpeed로 제한한 초기 속도를 저장합니다.
	 * @note 현재 위치·속도만 초기화합니다. 이전 위치는 SnapInterpolation으로 별도 동기화합니다.
	 */
	void Reset(const FWorldBounds& Bounds, double MaxSpeed);

	/**
	 * 현재 위치를 이전 위치에 저장한 뒤 활성 군집의 평균 위치를 추적하도록 가속도·속도·위치를 갱신합니다.
	 * @param DeltaTimeSeconds 초 단위 이동 간격입니다. 위치는 장면 단위, MaxSpeed는 장면 단위/초입니다.
	 * @param ActiveBirdCount 추적 가속도를 계산하는 경우 BirdPositions 용량 안의 양수여야 합니다.
	 * @param bSoftBoundary true이면 이동 위치의 강제 경계 제한을 생략합니다.
	 * @note 비활성이면 이전 위치만 갱신합니다. 활성 상태에서 MaxSpeed가 0이면 현재 속도를 0으로 만들고 이동하지 않습니다.
	 */
	void Update(double DeltaTimeSeconds, const FBirdVectorBuffer& BirdPositions, int ActiveBirdCount, const FWorldBounds& Bounds, bool bEnabled, double MaxSpeed, bool bSoftBoundary);

	/**
	 * 현재 위치를 이전 위치에 복사하여 포식자 보간의 두 끝점을 맞춥니다.
	 * @note 현재 위치·속도는 변경하지 않습니다.
	 */
	void SnapInterpolation();

	/**
	 * 현재 위치를 포식자 여유 폭만큼 안쪽의 월드 경계로 제한하고 밖으로 향하는 속도 성분을 제거합니다.
	 * @note 시간과 이전 위치는 변경하지 않습니다. 경계 모드에 따른 호출 여부는 상위 계층이 결정합니다.
	 */
	void ReconcileBounds(const FWorldBounds& Bounds);

	/**
	 * 새의 현재 위치와 포식자 중심 사이 거리가 회피 반경 안이면 중심에서 멀어지는 힘을 누적합니다.
	 * @param AvoidanceRadius 중심 거리로 판단하는 회피 범위입니다. 장애물 표면 거리와 구분합니다.
	 * @param AvoidanceWeight 기본 회피 강도에 곱할 설정 가중치입니다.
	 * @param InOutForce 기존 힘에 거리 감쇠를 적용한 포식자 회피 힘을 누적하여 반환합니다.
	 * @note 반경 이상이면 변경하지 않습니다. 새의 속도를 사용한 미래 위치 예측은 수행하지 않습니다.
	 * @note 거리가 Epsilon 미만이면 X 추가분은 기본 강도의 +X입니다. Y·Z는 감쇠식을 유지하며 정확히 겹치면 0입니다.
	 * @note 0 나눗셈은 별도의 최소 거리로 방지하며 위치·속도는 직접 변경하지 않습니다.
	 */
	void AccumulateAvoidanceForce(const FVector3D& BirdPosition, double AvoidanceRadius, double AvoidanceWeight, FVector3D& InOutForce) const;

	/**
	 * 현재 위치 XYZ(float 3개)를 수정 가능한 ABI 뷰로 빌려줍니다.
	 * @note 저장소는 객체가 소유하며 객체 수명 동안 주소가 고정됩니다. 호출자가 해제하지 않습니다.
	 */
	float* GetPositionAbiData()
	{
		return Position.GetData();
	}

	/** 현재 위치 XYZ(float 3개)를 객체 수명에 종속된 읽기 전용 ABI 뷰로 빌려줍니다. */
	const float* GetPositionAbiData() const
	{
		return Position.GetData();
	}

	/**
	 * 표시 보간에 사용할 이전 위치 XYZ(float 3개)를 가변 ABI 뷰로 빌려줍니다.
	 * @note Update 또는 SnapInterpolation이 내용을 바꾸며 소유권은 이전하지 않습니다.
	 */
	float* GetPreviousPositionAbiData()
	{
		return PreviousPosition.GetData();
	}

	/** 표시 보간용 이전 위치 XYZ(float 3개)를 읽기 전용 ABI 뷰로 빌려줍니다. */
	const float* GetPreviousPositionAbiData() const
	{
		return PreviousPosition.GetData();
	}

	/** 현재 속도 XYZ(float 3개, 장면 단위/초)를 객체 수명 동안 유효한 가변 ABI 뷰로 빌려줍니다. */
	float* GetVelocityAbiData()
	{
		return Velocity.GetData();
	}

	/** 현재 속도 XYZ(float 3개)를 읽기 전용 ABI 뷰로 빌려줍니다. 이후 갱신은 같은 저장소에 반영됩니다. */
	const float* GetVelocityAbiData() const
	{
		return Velocity.GetData();
	}

private:
	/**
	 * 활성 군집의 평균 위치를 월드 안쪽으로 제한한 목표로 삼고 원하는 속도와 현재 속도의 차이를 계산합니다.
	 * @return 추적 이득을 적용한 가속도입니다. 상태는 변경하지 않으며 크기 제한은 적분 단계가 수행합니다.
	 * @pre ActiveBirdCount는 0보다 크고 BirdPositions 용량 이하여야 합니다.
	 */
	[[nodiscard]] FVector3D CalculatePursuitAcceleration(const FBirdVectorBuffer& BirdPositions, int ActiveBirdCount, const FWorldBounds& Bounds, double MaxSpeed) const;

	/**
	 * 가속도 방향은 유지하고 크기를 최대 가속도로 제한한 뒤 현재 속도에 Acceleration × dt를 더합니다.
	 * @note 축별 결과를 float로 저장하며 위치는 아직 이동하지 않습니다.
	 */
	void IntegrateAcceleration(double DeltaTimeSeconds, const FVector3D& Acceleration);

	/**
	 * 현재 속력에 상한을 적용하고 반올림한 float 속도로 위치를 적분합니다.
	 * Soft 모드가 아니면 포식자 여유 경계 안으로 위치를 제한하고 밖으로 향하는 축 속도를 제거합니다.
	 * @note 축별 속도 저장 → 위치 적분 순서를 유지하며 이전 위치는 변경하지 않습니다.
	 */
	void LimitSpeedAndIntegratePosition(double DeltaTimeSeconds, const FWorldBounds& Bounds, double MaxSpeed, bool bSoftBoundary);

	// 현재·이전 위치는 렌더링 보간에 사용하며 속도와 함께 float로 저장합니다.
	FVector3f Position;

	FVector3f PreviousPosition;

	FVector3f Velocity;
};
