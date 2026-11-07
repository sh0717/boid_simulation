#pragma once
#include "core/WorldBounds.h"

namespace boids
{
	// 목표의 고정 위치 버퍼를 소유하고 위치 갱신과 목표 힘 계산을 담당합니다.
	// 시간과 설정은 호출 동안만 빌리며 멤버에 보관하지 않습니다.
	class FGoal
	{
	public:
		/**
		 * 목표 위상으로 닫힌 삼각함수 경로의 위치를 계산하고 작은 월드에서는 축별 경로 크기를 축소합니다.
		 * @param GoalTime 상위 상태가 관리하는 초 단위 목표 위상입니다. 주기 밖 값은 한 주기 안으로 감쌉니다.
		 * @note 목표 위치만 갱신하며 위상·시뮬레이션 시간은 진행시키지 않습니다.
		 */
		void Update(double GoalTime, const FWorldBounds& Bounds);

		/**
		 * 새의 현재 위치에서 목표로 향하는 변위에 기본 배율과 AttractionWeight를 곱해 누적합니다.
		 * @param InOutForce 기존 군집·외부 힘을 보존하면서 목표 인력을 추가할 벡터입니다.
		 * @note 거리 정규화·적분·속력 제한은 수행하지 않으며 새와 목표의 위치도 변경하지 않습니다.
		 */
		void AccumulateAttractionForce(const FVector3D& BirdPosition, double AttractionWeight, FVector3D& InOutForce) const;

		/**
		 * 목표의 현재 위치 XYZ(float 3개)를 가변 ABI 뷰로 빌려줍니다.
		 * @note 객체 수명 동안 주소가 고정되며 호출자가 해제하거나 크기를 바꾸지 않습니다.
		 */
		float* GetPositionAbiData()
		{
			return Position.GetData();
		}

		/**
		 * 목표의 현재 위치 XYZ(float 3개)를 읽기 전용 ABI 뷰로 빌려줍니다.
		 * @note 값 복사가 아니므로 다음 Update 결과가 같은 뷰에 반영됩니다.
		 */
		const float* GetPositionAbiData() const
		{
			return Position.GetData();
		}

	private:
		FVector3f Position;
	};
} // namespace boids
