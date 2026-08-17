import { Module, Global } from '@nestjs/common';
import { createFirestore } from './firestore';

export const FIRESTORE = 'FIRESTORE';

@Global()
@Module({
  providers: [
    {
      provide: FIRESTORE,
      useFactory: () => createFirestore(),
    },
  ],
  exports: [FIRESTORE],
})
export class FirestoreModule {}
