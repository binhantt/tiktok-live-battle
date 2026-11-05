import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type SystemSettingsDocument = HydratedDocument<SystemSettingsModel>;

@Schema({ collection: 'system_settings', timestamps: true })
export class SystemSettingsModel {
  @Prop({ required: true, unique: true, default: 'default' })
  key!: string;

  @Prop({ required: true, default: 10 })
  likesPerSpawn!: number;

  @Prop({ required: true, default: 100 })
  maxCharacters!: number;

  @Prop({ required: true, default: 20 })
  battleTickRate!: number;

  @Prop({ required: true, default: 50 })
  maxLikeRatePerSecond!: number;

  @Prop({ default: 180, min: 10, max: 3600 })
  roundDurationSeconds!: number;

  @Prop({ default: 5, min: 0, max: 120 })
  roundBreakSeconds!: number;
}

export const SystemSettingsSchema = SchemaFactory.createForClass(SystemSettingsModel);
