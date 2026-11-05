import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type CharacterDocument = HydratedDocument<CharacterModel>;

@Schema({ collection: 'characters', timestamps: true })
export class CharacterModel {
  @Prop({ required: true, index: true })
  sessionId!: string;

  @Prop({ required: true, index: true })
  ownerId!: string;

  @Prop({ required: true })
  username!: string;

  @Prop()
  avatarUrl?: string;

  @Prop({ required: true, enum: ['police', 'smuggler'], default: 'police', index: true })
  faction!: 'police' | 'smuggler';

  @Prop({ required: true, enum: ['normal', 'rare', 'epic', 'legendary', 'mythic'], default: 'normal' })
  type!: 'normal' | 'rare' | 'epic' | 'legendary' | 'mythic';

  @Prop({ type: String, default: 'brawler' })
  characterClass?: string;

  @Prop({ required: true, default: 100 })
  hp!: number;

  @Prop({ required: true, default: 100 })
  maxHp!: number;

  @Prop({ required: true, default: 12 })
  damage!: number;

  @Prop({ required: true, default: 95 })
  speed!: number;

  @Prop({ required: true, default: 1 })
  level!: number;

  @Prop({ required: true, default: 0 })
  kills!: number;

  @Prop({ required: true, enum: ['alive', 'dead'], default: 'alive', index: true })
  status!: 'alive' | 'dead';
}

export const CharacterSchema = SchemaFactory.createForClass(CharacterModel);
