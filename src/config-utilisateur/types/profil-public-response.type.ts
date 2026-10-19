import { StatutPresence } from '@prisma/client';

export interface ProfilPublicResponse {
  type: 'profilPublic';
  idUtilisateur: string;
  alias: string | null;
  avatar?: string | null;
  statutPresence: StatutPresence;
  vuLaDerniereFois: string | null;
  actif: boolean;
}
