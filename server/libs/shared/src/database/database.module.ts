import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TikTokUserModel, TikTokUserSchema } from '../schemas/user.schema';
import { BattleSessionModel, BattleSessionSchema } from '../schemas/battle-session.schema';
import { CharacterModel, CharacterSchema } from '../schemas/character.schema';
import { GiftEventModel, GiftEventSchema } from '../schemas/gift-event.schema';
import { SystemSettingsModel, SystemSettingsSchema } from '../schemas/settings.schema';

@Global()
@Module({
  imports: [
    MongooseModule.forRootAsync({
      useFactory: () => ({
        uri: process.env.MONGODB_URI || 'mongodb://localhost:27017',
        dbName: process.env.MONGODB_DATABASE || 'tiktok_battle',
      }),
    }),
    MongooseModule.forFeature([
      { name: TikTokUserModel.name, schema: TikTokUserSchema },
      { name: BattleSessionModel.name, schema: BattleSessionSchema },
      { name: CharacterModel.name, schema: CharacterSchema },
      { name: GiftEventModel.name, schema: GiftEventSchema },
      { name: SystemSettingsModel.name, schema: SystemSettingsSchema },
    ]),
  ],
  exports: [MongooseModule],
})
export class SharedDatabaseModule {}
