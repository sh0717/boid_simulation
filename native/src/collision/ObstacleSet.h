#pragma once
#include "collision/Obstacle.h"
#include "collision/ObstacleDescriptor.h"
#include <memory>
#include <vector>

// 활성 장애물 객체를 고유 소유하며 같은 형태의 갱신에서는 객체 주소를 유지합니다.
// 동기화마다 활성 설명을 적용하며 ABI 원본 레코드는 소유하지 않습니다.
// 형태 변경이나 제거는 해당 객체의 대여 참조를 무효화합니다.
// 객체 소유와 대여 수명을 유지하기 위해 복사·이동을 금지합니다.
class FObstacleSet
{
public:
	FObstacleSet();

	FObstacleSet(const FObstacleSet&) = delete;

	FObstacleSet& operator=(const FObstacleSet&) = delete;

	FObstacleSet(FObstacleSet&&) = delete;

	FObstacleSet& operator=(FObstacleSet&&) = delete;

	// 활성 수는 0~MaxObstacles이며 추가·형태 변경 시에만 객체를 생성합니다.
	void Synchronize(const FObstacleDescriptorSnapshot& Snapshot);

	/** 현재 소유한 활성 장애물 수를 반환합니다. */
	int GetActiveObstacleCount() const;

	/** 유효 인덱스의 장애물을 빌려줍니다. 제거·형태 변경 또는 소유 객체 소멸 시 무효화됩니다. */
	const FObstacle& GetObstacle(int ObstacleIndex) const;

private:
	std::vector<std::unique_ptr<FObstacle>> OwnedObstacles;
};
