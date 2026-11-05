import { PipelineStage } from 'mongoose';

// Aggregate the gift ledger so existing donations also appear without a migration.
export function donorLeaderboardPipeline(): PipelineStage[] {
  return [
    { $match: { processed: true } },
    { $group: {
      _id: '$tiktokUserId',
      totalGifts: { $sum: '$quantity' },
      totalDiamonds: { $sum: { $multiply: ['$quantity', { $ifNull: ['$diamondCount', 1] }] } },
      lastUsername: { $last: '$username' },
      lastAvatar: { $last: '$avatarUrl' },
    } },
    { $sort: { totalDiamonds: -1, totalGifts: -1, _id: 1 } },
    { $limit: 20 },
    { $lookup: { from: 'users', localField: '_id', foreignField: 'tiktokUserId', as: 'user' } },
    { $project: {
      _id: 0,
      tiktokUserId: '$_id',
      username: { $ifNull: [{ $arrayElemAt: ['$user.username', 0] }, { $ifNull: ['$lastUsername', '$_id'] }] },
      avatarUrl: { $ifNull: [{ $arrayElemAt: ['$user.avatarUrl', 0] }, '$lastAvatar'] },
      faction: { $arrayElemAt: ['$user.faction', 0] },
      totalGifts: 1,
      totalDiamonds: 1,
    } },
  ];
}
