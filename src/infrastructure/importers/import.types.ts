import type { Course } from '../../domain/course/course.types';

export type ImportField =
  | 'academicTerm'
  | 'courseCode'
  | 'courseName'
  | 'rawGrade'
  | 'sequenceCode'
  | 'publicElectiveCategory'
  | 'courseCategory'
  | 'courseNature'
  | 'credit'
  | 'studyMode'
  | 'isMajor'
  | 'examDate'
  | 'importedGradePoint'
  | 'retakeText'
  | 'examType'
  | 'openingDepartment'
  | 'passed'
  | 'isValid'
  | 'userExcluded'
  | 'specialReason';

/** 字段中文名（映射确认界面使用）。放在纯类型模块，避免静态引入解析器。 */
export const fieldLabels: Record<ImportField, string> = {
  academicTerm: '学年学期',
  courseCode: '课程号',
  courseName: '课程名',
  rawGrade: '成绩',
  sequenceCode: '课序号',
  publicElectiveCategory: '校公选课类别',
  courseCategory: '课程类别',
  courseNature: '课程性质',
  credit: '学分',
  studyMode: '修读方式',
  isMajor: '是否主修',
  examDate: '考试日期',
  importedGradePoint: '绩点',
  retakeText: '重修重考',
  examType: '考试类型',
  openingDepartment: '开课单位',
  passed: '是否及格',
  isValid: '是否有效',
  userExcluded: '是否排除',
  specialReason: '特殊原因'
};

/** 解析必需字段（同义词匹配与置信度计算共用） */
export const requiredFields: ImportField[] = ['courseCode', 'courseName', 'rawGrade', 'credit'];

export interface ImportIssue {
  sheetName: string;
  rowNumber?: number;
  field?: ImportField | 'header' | 'file';
  originalValue?: unknown;
  severity: 'warning' | 'error';
  message: string;
  suggestion?: string;
}

export interface ImportPreview {
  fileName: string;
  sheetNames: string[];
  selectedSheetName: string;
  source: 'jlu-sheet' | 'generic-sheet';
  headerMapping: Partial<Record<ImportField, string>>;
  /** 工作表的全部列名（映射确认界面使用） */
  availableColumns: string[];
  totalRows: number;
  courses: Course[];
  issues: ImportIssue[];
  importableCount: number;
  errorCount: number;
  warningCount: number;
  hasExclusionColumn: boolean;
  restoredExclusionCount: number;
}

export type ImportMergeMode = 'replace' | 'append';

export interface MergeResult {
  courses: Course[];
  addedCount: number;
  replacedCount: number;
  exactDuplicateCount: number;
  restoredExclusionCount: number;
}
