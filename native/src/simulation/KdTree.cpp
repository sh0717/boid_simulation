#include "simulation/KdTree.h"
#include <algorithm>
#include <cassert>

namespace boids
{
	bool FKdTree::IsBirdBeforeOnAxis(const FBirdVectorBuffer& Positions, int LhsBirdIndex, int RhsBirdIndex, EAxis Axis)
	{
		const double Delta = static_cast<double>(Positions.GetComponent(LhsBirdIndex, Axis)) - Positions.GetComponent(RhsBirdIndex, Axis);
		return Delta < 0 || (Delta == 0 && LhsBirdIndex < RhsBirdIndex);
	}

	FKdTree::FPartition FKdTree::PartitionIndices(const FBirdVectorBuffer& Positions, int FirstNodeIndex, int LastNodeIndex, EAxis Axis)
	{
		const int PivotBirdIndex = BirdIndices[(FirstNodeIndex + LastNodeIndex) / 2];
		int LeftScanNodeIndex = FirstNodeIndex;
		int RightScanNodeIndex = LastNodeIndex;
		while (LeftScanNodeIndex <= RightScanNodeIndex)
		{
			while (IsBirdBeforeOnAxis(Positions, BirdIndices[LeftScanNodeIndex], PivotBirdIndex, Axis))
			{
				++LeftScanNodeIndex;
			}
			while (IsBirdBeforeOnAxis(Positions, PivotBirdIndex, BirdIndices[RightScanNodeIndex], Axis))
			{
				--RightScanNodeIndex;
			}
			if (LeftScanNodeIndex <= RightScanNodeIndex)
			{
				std::swap(BirdIndices[LeftScanNodeIndex], BirdIndices[RightScanNodeIndex]);
				++LeftScanNodeIndex;
				--RightScanNodeIndex;
			}
		}
		return {RightScanNodeIndex, LeftScanNodeIndex};
	}

	void FKdTree::SelectMedian(const FBirdVectorBuffer& Positions, int FirstNodeIndex, int LastNodeIndex, int MedianNodeIndex, EAxis Axis)
	{
		while (FirstNodeIndex < LastNodeIndex)
		{
			const FPartition Partition = PartitionIndices(Positions, FirstNodeIndex, LastNodeIndex, Axis);
			if (MedianNodeIndex <= Partition.LeftLastNodeIndex)
			{
				LastNodeIndex = Partition.LeftLastNodeIndex;
			}
			else if (MedianNodeIndex >= Partition.RightFirstNodeIndex)
			{
				FirstNodeIndex = Partition.RightFirstNodeIndex;
			}
			else
			{
				return;
			}
		}
	}

	int FKdTree::BuildBranch(const FBirdVectorBuffer& Positions, int FirstNodeIndex, int LastNodeIndex, int Depth)
	{
		if (FirstNodeIndex > LastNodeIndex)
		{
			return -1;
		}
		// 중앙값 하나를 확정한 뒤 좌우 구간을 재귀 분할하여 트리 깊이를 제한합니다.
		const int MedianNodeIndex = (FirstNodeIndex + LastNodeIndex) / 2;
		const EAxis Axis = AllAxes[Depth % constants::AxisCount];
		SelectMedian(Positions, FirstNodeIndex, LastNodeIndex, MedianNodeIndex, Axis);
		SplitAxes[MedianNodeIndex] = Axis;
		// 조회 중 불변인 분할 좌표를 저장해 후보마다 위치 버퍼를 간접 참조하지 않습니다.
		SplitCoordinates[MedianNodeIndex] = Positions.GetComponent(BirdIndices[MedianNodeIndex], Axis);
		LeftChildNodes[MedianNodeIndex] = BuildBranch(Positions, FirstNodeIndex, MedianNodeIndex - 1, Depth + 1);
		RightChildNodes[MedianNodeIndex] = BuildBranch(Positions, MedianNodeIndex + 1, LastNodeIndex, Depth + 1);
		return MedianNodeIndex;
	}

	void FKdTree::Rebuild(const FBirdVectorBuffer& BirdPositions, int BirdCount)
	{
		assert(BirdCount >= 0 && BirdCount <= constants::MaxBirdCount);
		assert(BirdPositions.GetBirdCapacity() >= BirdCount);
		for (int NodeIndex = 0; NodeIndex < BirdCount; ++NodeIndex)
		{
			BirdIndices[NodeIndex] = NodeIndex;
		}
		RootNode = BuildBranch(BirdPositions, 0, BirdCount - 1, 0);
	}

	void FKdTree::QueryCandidates(const FVector3D& QueryPosition, double QueryRadius, std::vector<int>& OutCandidateIndices) const
	{
		OutCandidateIndices.clear();
		// 균형 트리의 깊이만큼만 대기하므로 MaxBirdCount개 노드에 고정 스택으로 충분합니다.
		std::array<int, constants::KdTraversalStackCapacity> PendingNodes;
		int PendingNodeCount = 0;
		if (RootNode >= 0)
		{
			PendingNodes[PendingNodeCount++] = RootNode;
		}
		while (PendingNodeCount)
		{
			const int NodeIndex = PendingNodes[--PendingNodeCount];
			const int BirdIndex = BirdIndices[NodeIndex];
			const EAxis Axis = SplitAxes[NodeIndex];
			OutCandidateIndices.push_back(BirdIndex);
			// 조회 구가 분할 평면에 닿을 수 있는 쪽만 방문합니다. 정확한 구 거리 검사는 군집에서 수행합니다.
			const double Delta = QueryPosition[Axis] - SplitCoordinates[NodeIndex];
			if (LeftChildNodes[NodeIndex] != -1 && Delta <= QueryRadius)
			{
				PendingNodes[PendingNodeCount++] = LeftChildNodes[NodeIndex];
			}
			if (RightChildNodes[NodeIndex] != -1 && Delta >= -QueryRadius)
			{
				PendingNodes[PendingNodeCount++] = RightChildNodes[NodeIndex];
			}
		}
	}
} // namespace boids
