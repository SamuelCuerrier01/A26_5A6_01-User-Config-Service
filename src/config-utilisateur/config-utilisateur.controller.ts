import {
  Body,
  Controller,
  Get,
  Headers,
  Patch,
  Put,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  EN_TETE_JETON_INTERNE,
  InternalTokenGuard,
} from '../internal/internal-token.guard';
import { ConfigUtilisateurService } from './config-utilisateur.service';
import { DefinirPresenceDto } from './dto/definir-presence.dto';
import { ListerProfilsPublicsDto } from './dto/lister-profils-publics.dto';
import { MettreAJourConfigDto } from './dto/mettre-a-jour-config.dto';
import { ConfigUtilisateurResponse } from './types/config-utilisateur-response.type';
import { ProfilPublicResponse } from './types/profil-public-response.type';

const LONGUEUR_MAX_ID_UTILISATEUR = 255;

@ApiTags('Configuration utilisateur')
@ApiHeader({
  name: 'x-user-id',
  required: true,
  description:
    "Identifiant de l'utilisateur authentifié, transmis par l'API Gateway",
})
@ApiHeader({
  name: EN_TETE_JETON_INTERNE,
  required: true,
  description: 'Secret partagé INTERNAL_SERVICE_TOKEN, posé par l’API Gateway',
})
@Controller('config-utilisateur')
@UseGuards(InternalTokenGuard)
export class ConfigUtilisateurController {
  constructor(
    private readonly configUtilisateurService: ConfigUtilisateurService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      "Récupère la configuration de l'utilisateur connecté (créée avec des valeurs par défaut si elle n'existe pas encore)",
  })
  recupererMaConfig(
    @Headers('x-user-id') idUtilisateur?: string,
  ): Promise<ConfigUtilisateurResponse> {
    return this.configUtilisateurService.recupererOuCreer(
      this.exigerIdUtilisateur(idUtilisateur),
    );
  }

  @Get('publiques')
  @ApiOperation({
    summary:
      "Profils publics d'autres utilisateurs : alias, avatar et présence (effective via `actif`)",
  })
  listerProfilsPublics(
    @Query() requete: ListerProfilsPublicsDto,
    @Headers('x-user-id') idUtilisateur?: string,
  ): Promise<ProfilPublicResponse[]> {
    this.exigerIdUtilisateur(idUtilisateur);
    return this.configUtilisateurService.listerProfilsPublics(
      requete.ids,
      requete.inclureAvatar ?? true,
    );
  }

  @Patch()
  @ApiOperation({
    summary:
      "Met à jour l'alias, le thème, la langue, le mode de notification ou l'avatar de l'utilisateur connecté",
  })
  mettreAJourMaConfig(
    @Body() dto: MettreAJourConfigDto,
    @Headers('x-user-id') idUtilisateur?: string,
  ): Promise<ConfigUtilisateurResponse> {
    return this.configUtilisateurService.mettreAJour(
      this.exigerIdUtilisateur(idUtilisateur),
      dto,
    );
  }

  @Put('presence')
  @ApiOperation({
    summary: "Définit le statut de présence de l'utilisateur connecté",
  })
  definirMaPresence(
    @Body() dto: DefinirPresenceDto,
    @Headers('x-user-id') idUtilisateur?: string,
  ): Promise<ConfigUtilisateurResponse> {
    return this.configUtilisateurService.definirPresence(
      this.exigerIdUtilisateur(idUtilisateur),
      dto.statut,
    );
  }

  private exigerIdUtilisateur(idUtilisateur?: string): string {
    const identifiant = idUtilisateur?.trim();
    if (!identifiant || identifiant.length > LONGUEUR_MAX_ID_UTILISATEUR) {
      throw new UnauthorizedException('Utilisateur non authentifié');
    }
    return identifiant;
  }
}
