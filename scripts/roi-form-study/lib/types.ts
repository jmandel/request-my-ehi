export interface OrgCategory {
  category_id: string;
  size: string;
  region: string;
  ownership: string;
  target_count: number;
  description: string;
}

export interface Organization {
  org_id: string;
  name: string;
  category_id: string;
  size: string;
  region: string;
  state: string;
  city: string;
  ownership: string;
  website: string;
  bed_count?: number;
  notes?: string;
}

export interface FormRetrieval {
  org_id: string;
  search_queries: Array<{ query: string; results_found: number }>;
  forms_found: Array<{
    url: string;
    filename: string;
    download_success: boolean;
    document_type: string;
    is_patient_access_specific: boolean;
    notes?: string;
  }>;
  no_form_found: boolean;
  retrieval_difficulty: "easy" | "moderate" | "hard" | "impossible";
  notes?: string;
}

export interface FormMetadata {
  filename: string;
  file_size_bytes: number;
  page_count: number;
  has_text_layer: boolean;
  text_preview: string;
  full_text: string;
  full_text_chars: number;
  fillable_field_count: number;
  fillable_field_names: string[];
  font_count: number;
  embedded_image_count: number;
  is_image_only_scan: boolean;
}

export interface FormEvaluation {
  org_id: string;
  org_name: string;
  form_url: string;
  evaluation_text: string;
  evaluated_at: string;
}

export interface DimensionScore {
  score: number;
  rationale: string;
  subscores?: Record<string, unknown>;
}

export interface FormScores {
  org_id: string;
  org_name: string;
  category_id: string;
  form_url: string;
  scores: {
    findability: DimensionScore;
    technical_accessibility: DimensionScore;
    content_design: DimensionScore;
    patient_centeredness: DimensionScore;
    compliance_signals: DimensionScore;
    overall: {
      score: number;
      grade: string;
      summary: string;
    };
  };
  evaluated_at: string;
}

export interface RunOptions {
  limit?: number;
  filter?: string;
  parallel: number;
  dryRun: boolean;
  force: boolean;
  model: string;
}
