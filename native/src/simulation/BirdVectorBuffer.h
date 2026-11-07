#pragma once
#include "core/Vector3D.h"
#include <algorithm>
#include <cassert>
#include <vector>

// 개체의 XYZ 성분을 연속 float32 벡터에 동적 소유합니다.
// 계산에는 개체 인덱스와 FVector3D를 제공하고 평탄 배열 배치는 내부에 숨깁니다.
// 생성 후 크기를 고정하며 ABI 주소와 대여 수명을 지키기 위해 복사·이동을 금지합니다.
class FBirdVectorBuffer
{
public:
	/** MaxBirdCount개 개체의 XYZ를 담을 고정 용량 float 저장소를 할당하고 0으로 초기화합니다. */
	FBirdVectorBuffer()
		: Components(constants::BirdVectorComponentCount, 0.0f)
	{
	}

	FBirdVectorBuffer(const FBirdVectorBuffer&) = delete;

	FBirdVectorBuffer& operator=(const FBirdVectorBuffer&) = delete;

	FBirdVectorBuffer(FBirdVectorBuffer&&) = delete;

	FBirdVectorBuffer& operator=(FBirdVectorBuffer&&) = delete;

	/** 활성 개체 수가 아닌 저장 가능한 최대 개체 수를 반환합니다. */
	[[nodiscard]] int GetBirdCapacity() const noexcept
	{
		return constants::MaxBirdCount;
	}

	/**
	 * 유효 개체의 XYZ float 세 값을 double로 변환하여 독립된 벡터 값으로 반환합니다.
	 * @pre BirdIndex는 [0, GetBirdCapacity()) 범위여야 합니다.
	 */
	[[nodiscard]] FVector3D GetVector(int BirdIndex) const
	{
		return {GetComponent(BirdIndex, EAxis::X), GetComponent(BirdIndex, EAxis::Y), GetComponent(BirdIndex, EAxis::Z)};
	}

	/**
	 * 유효 개체의 XYZ를 X → Y → Z 순서로 각각 float로 변환하여 저장합니다.
	 * @note 다른 개체의 성분과 저장소의 주소·크기는 변경하지 않습니다.
	 */
	void SetVector(int BirdIndex, const FVector3D& Value)
	{
		for (EAxis Axis : AllAxes)
		{
			GetComponent(BirdIndex, Axis) = static_cast<float>(Value[Axis]);
		}
	}

	/**
	 * 개체와 축에 해당하는 float 성분의 가변 참조를 반환합니다.
	 * @note 참조에 대한 쓰기는 실제 버퍼를 변경하며 참조 수명은 이 객체의 수명에 종속됩니다.
	 */
	float& GetComponent(int BirdIndex, EAxis Axis)
	{
		return Components[GetComponentOffset(BirdIndex, Axis)];
	}

	/**
	 * 개체와 축에 해당하는 float 성분의 읽기 전용 참조를 반환합니다.
	 * @pre 개체는 저장 용량 안의 인덱스이고 Axis는 X·Y·Z 중 하나여야 합니다.
	 */
	const float& GetComponent(int BirdIndex, EAxis Axis) const
	{
		return Components[GetComponentOffset(BirdIndex, Axis)];
	}

	/**
	 * 원본의 전체 XYZ 저장소를 기존 저장소에 복사하여 이전 위치 스냅샷 등을 갱신합니다.
	 * @note 재할당하지 않으며 자기 자신을 전달하면 아무 작업도 하지 않습니다.
	 */
	void CopyFrom(const FBirdVectorBuffer& Source)
	{
		if (this == &Source)
		{
			return;
		}
		std::copy(Source.Components.begin(), Source.Components.end(), Components.begin());
	}

	/**
	 * BirdVectorComponentCount개의 연속 float 저장소를 가변 ABI 뷰로 빌려줍니다.
	 * @note 객체 수명 동안 주소는 고정됩니다. 호출자는 해제·재할당하거나 용량 밖 원소에 접근하지 않습니다.
	 */
	float* GetAbiData() noexcept
	{
		return Components.data();
	}

	/** 전체 XYZ 저장소를 읽기 전용 ABI 뷰로 빌려줍니다. 이후 값 갱신도 같은 뷰에 반영됩니다. */
	const float* GetAbiData() const noexcept
	{
		return Components.data();
	}

private:
	/**
	 * 개체·축 범위를 assert로 확인하고 BirdIndex × AxisCount + Axis의 연속 저장 오프셋을 반환합니다.
	 * @note Release 빌드의 입력 검증을 대신하지 않으므로 호출자는 항상 유효 인덱스를 제공해야 합니다.
	 */
	static int GetComponentOffset(int BirdIndex, EAxis Axis)
	{
		assert(BirdIndex >= 0 && BirdIndex < constants::MaxBirdCount);
		const int AxisIndex = ToIndex(Axis);
		assert(AxisIndex >= 0 && AxisIndex < constants::AxisCount);
		return BirdIndex * constants::AxisCount + AxisIndex;
	}

	std::vector<float> Components;
};
