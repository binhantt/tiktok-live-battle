import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type GiftEventDocument = HydratedDocument<GiftEventModel>;

@Schema({ collection: 'gift_events', timestamps: { createdAt: true, updatedAt: false } })
export class GiftEventModel {
  @Prop({ required: true, index: true })
  sessionId!: string;

  @Prop({ required: true, unique: true, index: true })
  eventKey!: string;

  @Prop({ required: true, index: true })
  tiktokUserId!: string;

  @Prop()
  username?: string;

  @Prop()
  avatarUrl?: string;

  @Prop({ required: true })
  giftId!: string;

  @Prop({ required: true })
  giftName!: string;

  @Prop({ required: true })
  quantity!: number;

  @Prop()
  diamondCount?: number;

  @Prop({ default: false })
  processed!: boolean;
}

export const GiftEventSchema = SchemaFactory.createForClass(GiftEventModel);
