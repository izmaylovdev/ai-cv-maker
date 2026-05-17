import { Component, input } from '@angular/core';
import { RouterModule } from '@angular/router';
import { Profile } from '../../models/profile.model';

@Component({
  selector: 'app-profile-preview',
  standalone: true,
  imports: [RouterModule],
  templateUrl: './profile-preview.component.html',
})
export class ProfilePreviewComponent {
  readonly profile = input<Profile | null>(null);
  readonly loading = input(false);
}
