import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type TikTokUserDocument = HydratedDocument<TikTokUserModel>;

@Schema({ collection: 'users', timestamps: true })
export class TikTokUserModel {
  @Prop({ required: true, unique: true, index: true })
  tiktokUserId!: string;

  @Prop({ required: true })
  username!: string;

  @Prop()
  avatarUrl?: string;

  @Prop({ enum: ['police', 'smuggler'], default: 'police' })
  faction?: 'police' | 'smuggler';

  @Prop({ default: 0 })
  totalLikes!: number;

  @Prop({ default: 0 })
  totalGifts!: number;

  @Prop({ default: 0, index: true })
  totalPoints!: number;

  @Prop({ default: 1 })
  level!: number;
}

export const TikTokUserSchema = SchemaFactory.createForClass(TikTokUserModel);
