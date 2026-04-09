export interface WorkExperience {
  id?: string;
  company: string;
  role: string;
  startDate: string;
  endDate?: string;
  description: string;
}

export interface Education {
  id?: string;
  institution: string;
  degree: string;
  field: string;
  startYear: number;
  endYear?: number;
}

export interface Skill {
  id?: string;
  name: string;
  level: string;
}

export interface Profile {
  id: string;
  fullName: string;
  title: string;
  overview: string;
  workExperiences: WorkExperience[];
  educations: Education[];
  skills: Skill[];
}
