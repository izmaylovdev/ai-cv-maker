import { Component, ElementRef, ViewChild, input } from '@angular/core';
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

  @ViewChild('previewPersonal') private previewPersonal?: ElementRef<HTMLElement>;
  @ViewChild('previewWork') private previewWork?: ElementRef<HTMLElement>;
  @ViewChild('previewEdu') private previewEdu?: ElementRef<HTMLElement>;
  @ViewChild('previewSkills') private previewSkills?: ElementRef<HTMLElement>;

  getSectionElement(section: string): HTMLElement | undefined {
    const map: Record<string, ElementRef<HTMLElement> | undefined> = {
      personal: this.previewPersonal,
      workExperiences: this.previewWork,
      educations: this.previewEdu,
      skills: this.previewSkills,
    };
    return map[section]?.nativeElement;
  }
}
