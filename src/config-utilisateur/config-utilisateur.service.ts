import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { ConfigUtilisateur, Prisma, StatutPresence } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MettreAJourConfigDto } from './dto/mettre-a-jour-config.dto';
import { ConfigUtilisateurResponse } from './types/config-utilisateur-response.type';
import { ProfilPublicResponse } from './types/profil-public-response.type';

const CODE_CONTRAINTE_UNIQUE = 'P2002';

export const DELAI_PRESENCE_ACTIVE_MS = 90_000;

@Injectable()
export class ConfigUtilisateurService {
  constructor(private readonly prisma: PrismaService) {}

  async supprimer(idUtilisateur: string): Promise<boolean> {
    const { count } = await this.prisma.configUtilisateur.deleteMany({
      where: { idUtilisateur },
    });
    return count > 0;
  }

  async recupererOuCreer(
    idUtilisateur: string,
  ): Promise<ConfigUtilisateurResponse> {
    const existant = await this.prisma.configUtilisateur.findUnique({
      where: { idUtilisateur },
    });
    if (existant) {
      return this.versReponse(existant);
    }

    try {
      const config = await this.prisma.configUtilisateur.create({
        data: { idUtilisateur },
      });
      return this.versReponse(config);
    } catch (erreur) {
      if (
        erreur instanceof Prisma.PrismaClientKnownRequestError &&
        erreur.code === CODE_CONTRAINTE_UNIQUE
      ) {
        const config = await this.prisma.configUtilisateur.findUnique({
          where: { idUtilisateur },
        });
        if (!config) {
          throw new ConflictException(
            'Configuration supprimée pendant sa création',
          );
        }
        return this.versReponse(config);
      }
      throw erreur;
    }
  }

  async mettreAJour(
    idUtilisateur: string,
    dto: MettreAJourConfigDto,
  ): Promise<ConfigUtilisateurResponse> {
    if (
      dto.alias === undefined &&
      dto.theme === undefined &&
      dto.langue === undefined &&
      dto.modeNotification === undefined &&
      dto.avatar === undefined
    ) {
      throw new BadRequestException('Aucune modification fournie');
    }

    const aliasTrim = dto.alias?.trim();
    const donnees = {
      ...(aliasTrim !== undefined
        ? { alias: aliasTrim === '' ? null : aliasTrim }
        : {}),
      ...(dto.theme !== undefined ? { theme: dto.theme } : {}),
      ...(dto.langue !== undefined ? { langue: dto.langue } : {}),
      ...(dto.modeNotification !== undefined
        ? { modeNotification: dto.modeNotification }
        : {}),
      ...(dto.avatar !== undefined ? { avatar: dto.avatar || null } : {}),
    };

    const config = await this.prisma.configUtilisateur.upsert({
      where: { idUtilisateur },
      update: donnees,
      create: { idUtilisateur, ...donnees },
    });
    return this.versReponse(config);
  }

  async definirPresence(
    idUtilisateur: string,
    statut: StatutPresence,
  ): Promise<ConfigUtilisateurResponse> {
    const vuLaDerniereFois = new Date();
    const config = await this.prisma.configUtilisateur.upsert({
      where: { idUtilisateur },
      update: { statutPresence: statut, vuLaDerniereFois },
      create: { idUtilisateur, statutPresence: statut, vuLaDerniereFois },
    });
    return this.versReponse(config);
  }

  async listerProfilsPublics(
    ids: string[],
    inclureAvatar = true,
    maintenant: Date = new Date(),
  ): Promise<ProfilPublicResponse[]> {
    const configs = await this.prisma.configUtilisateur.findMany({
      where: { idUtilisateur: { in: ids } },
      select: {
        idUtilisateur: true,
        alias: true,
        avatar: inclureAvatar,
        statutPresence: true,
        vuLaDerniereFois: true,
      },
    });
    return configs.map((config) => ({
      type: 'profilPublic' as const,
      idUtilisateur: config.idUtilisateur,
      alias: config.alias,
      ...(inclureAvatar ? { avatar: config.avatar ?? null } : {}),
      statutPresence: config.statutPresence,
      vuLaDerniereFois: config.vuLaDerniereFois
        ? config.vuLaDerniereFois.toISOString()
        : null,
      actif:
        config.statutPresence === StatutPresence.enLigne &&
        config.vuLaDerniereFois !== null &&
        maintenant.getTime() - config.vuLaDerniereFois.getTime() <=
          DELAI_PRESENCE_ACTIVE_MS,
    }));
  }

  private versReponse(config: ConfigUtilisateur): ConfigUtilisateurResponse {
    return {
      type: 'configUtilisateur',
      idUtilisateur: config.idUtilisateur,
      alias: config.alias,
      theme: config.theme,
      langue: config.langue,
      statutPresence: config.statutPresence,
      vuLaDerniereFois: config.vuLaDerniereFois
        ? config.vuLaDerniereFois.toISOString()
        : null,
      modeNotification: config.modeNotification,
      avatar: config.avatar,
    };
  }
}
