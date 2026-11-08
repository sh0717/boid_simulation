#include "simulation/KdTree.h"

#include <algorithm>
#include <bit>
#include <cassert>

static_assert(std::bit_width(static_cast<unsigned int>(constants::MaxBirdCount)) <= constants::KdTraversalStackCapacity);

bool FKdTree::IsBirdOrderedBeforeOnAxis(const FBirdVectorBuffer& Positions, int LhsBirdIndex, int RhsBirdIndex, EAxis Axis)
{
	const double AxisCoordinateDifference = static_cast<double>(Positions.GetComponent(LhsBirdIndex, Axis)) - Positions.GetComponent(RhsBirdIndex, Axis);
	return AxisCoordinateDifference < 0 || (AxisCoordinateDifference == 0 && LhsBirdIndex < RhsBirdIndex);
}

FKdTree::FPartitionBounds FKdTree::PartitionBirdIndicesByAxis(const FBirdVectorBuffer& Positions, int FirstNodeSlot, int LastNodeSlot, EAxis Axis)
{
	const int PivotBirdIndex = BirdIndexByNode[(FirstNodeSlot + LastNodeSlot) / 2];
	int LeftScanSlot = FirstNodeSlot;
	int RightScanSlot = LastNodeSlot;

	while (LeftScanSlot <= RightScanSlot)
	{
		while (IsBirdOrderedBeforeOnAxis(Positions, BirdIndexByNode[LeftScanSlot], PivotBirdIndex, Axis))
		{
			++LeftScanSlot;
		}

		while (IsBirdOrderedBeforeOnAxis(Positions, PivotBirdIndex, BirdIndexByNode[RightScanSlot], Axis))
		{
			--RightScanSlot;
		}

		if (LeftScanSlot <= RightScanSlot)
		{
			std::swap(BirdIndexByNode[LeftScanSlot], BirdIndexByNode[RightScanSlot]);
			++LeftScanSlot;
			--RightScanSlot;
		}
	}

	return {RightScanSlot, LeftScanSlot};
}

void FKdTree::PlaceMedianBirdInSlot(const FBirdVectorBuffer& Positions, int FirstNodeSlot, int LastNodeSlot, int MedianNodeSlot, EAxis Axis)
{
	while (FirstNodeSlot < LastNodeSlot)
	{
		const FPartitionBounds PartitionBounds = PartitionBirdIndicesByAxis(Positions, FirstNodeSlot, LastNodeSlot, Axis);
		if (MedianNodeSlot <= PartitionBounds.LeftPartitionLastSlot)
		{
			LastNodeSlot = PartitionBounds.LeftPartitionLastSlot;
		}
		else if (MedianNodeSlot >= PartitionBounds.RightPartitionFirstSlot)
		{
			FirstNodeSlot = PartitionBounds.RightPartitionFirstSlot;
		}
		else
		{
			return;
		}
	}
}

int FKdTree::BuildBalancedSubtree(const FBirdVectorBuffer& Positions, int FirstNodeSlot, int LastNodeSlot, int Depth)
{
	if (FirstNodeSlot > LastNodeSlot)
	{
		return -1;
	}

	// 중앙값 하나를 확정한 뒤 좌우 구간을 재귀 분할하여 트리 깊이를 제한합니다.
	const int MedianNodeSlot = (FirstNodeSlot + LastNodeSlot) / 2;
	const EAxis SplitAxis = AllAxes[Depth % constants::AxisCount];
	PlaceMedianBirdInSlot(Positions, FirstNodeSlot, LastNodeSlot, MedianNodeSlot, SplitAxis);

	SplitAxisByNode[MedianNodeSlot] = SplitAxis;
	// 조회 중 불변인 분할 좌표를 저장해 후보마다 위치 버퍼를 간접 참조하지 않습니다.
	SplitCoordinateByNode[MedianNodeSlot] = Positions.GetComponent(BirdIndexByNode[MedianNodeSlot], SplitAxis);

	LeftChildNodeIndexByNode[MedianNodeSlot] = BuildBalancedSubtree(Positions, FirstNodeSlot, MedianNodeSlot - 1, Depth + 1);
	RightChildNodeIndexByNode[MedianNodeSlot] = BuildBalancedSubtree(Positions, MedianNodeSlot + 1, LastNodeSlot, Depth + 1);

	return MedianNodeSlot;
}

void FKdTree::Rebuild(const FBirdVectorBuffer& BirdPositions, int BirdCount)
{
	assert(BirdCount >= 0 && BirdCount <= constants::MaxBirdCount);
	assert(BirdPositions.GetBirdCapacity() >= BirdCount);

	for (int NodeIndex = 0; NodeIndex < BirdCount; ++NodeIndex)
	{
		BirdIndexByNode[NodeIndex] = NodeIndex;
	}

	RootNodeIndex = BuildBalancedSubtree(BirdPositions, 0, BirdCount - 1, 0);
}

void FKdTree::QueryCandidates(const FVector3D& QueryPosition, double QueryRadius, std::vector<int>& OutCandidateIndices) const
{
	OutCandidateIndices.clear();

	// 균형 트리의 깊이만큼만 대기하므로 MaxBirdCount개 노드에 고정 스택으로 충분합니다.
	std::array<int, constants::KdTraversalStackCapacity> PendingNodes;
	int PendingNodeCount = 0;
	if (RootNodeIndex >= 0)
	{
		PendingNodes[PendingNodeCount++] = RootNodeIndex;
	}

	while (PendingNodeCount)
	{
		const int NodeIndex = PendingNodes[--PendingNodeCount];
		const int BirdIndex = BirdIndexByNode[NodeIndex];
		const EAxis SplitAxis = SplitAxisByNode[NodeIndex];
		OutCandidateIndices.push_back(BirdIndex);

		// 조회 구가 분할 평면에 닿을 수 있는 쪽만 방문합니다. 정확한 구 거리 검사는 군집에서 수행합니다.
		const double SignedDistanceToSplit = QueryPosition[SplitAxis] - SplitCoordinateByNode[NodeIndex];
		// 왼쪽을 먼저 넣고 오른쪽을 나중에 넣으므로 LIFO 스택은 오른쪽을 먼저 방문합니다.
		if (LeftChildNodeIndexByNode[NodeIndex] != -1 && SignedDistanceToSplit <= QueryRadius)
		{
			PendingNodes[PendingNodeCount++] = LeftChildNodeIndexByNode[NodeIndex];
		}

		if (RightChildNodeIndexByNode[NodeIndex] != -1 && SignedDistanceToSplit >= -QueryRadius)
		{
			PendingNodes[PendingNodeCount++] = RightChildNodeIndexByNode[NodeIndex];
		}
	}
}
