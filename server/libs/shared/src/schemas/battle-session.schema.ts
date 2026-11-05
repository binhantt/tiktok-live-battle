import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type BattleSessionDocument = HydratedDocument<BattleSessionModel>;

@Schema({ collection: 'battle_sessions', timestamps: true })
export class BattleSessionModel {
  @Prop({ required: true })
  streamerUsername!: string;

  @Prop({ required: true, enum: ['waiting', 'live', 'ended'], default: 'waiting', index: true })
  status!: 'waiting' | 'live' | 'ended';

  @Prop()
  startedAt?: Date;

  @Prop()
  endedAt?: Date;

  @Prop({ default: 0 })
  totalSpawned!: number;

  @Prop({ default: 0 })
  totalKills!: number;
}

export const BattleSessionSchema = SchemaFactory.createForClass(BattleSessionModel);
