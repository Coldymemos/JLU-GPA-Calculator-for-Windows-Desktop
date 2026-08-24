import {
  DeleteOutlined,
  DownloadOutlined,
  FolderOpenOutlined,
  UploadOutlined
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Descriptions,
  Divider,
  InputNumber,
  Modal,
  Radio,
  Space,
  Switch,
  Typography
} from 'antd';
import { useRef, useState } from 'react';
import { defaultAutoBackupSettings, type AutoBackupSettings } from '../../application/auto-backup';

interface Props {
  open: boolean;
  onClose: () => void;
  onResetAll: () => void;
  onExportData: () => void;
  onImportData: (file: File) => void;
  onBackupDatabase?: () => void;
  onRestoreDatabase?: () => void;
  /** M5 定时备份（桌面端） */
  autoBackup?: AutoBackupSettings;
  onSaveAutoBackup?: (settings: AutoBackupSettings) => Promise<void>;
  onPickBackupDirectory?: () => Promise<string | undefined>;
}

export function AboutDialog({
  open,
  onClose,
  onResetAll,
  onExportData,
  onImportData,
  onBackupDatabase,
  onRestoreDatabase,
  autoBackup,
  onSaveAutoBackup,
  onPickBackupDirectory
}: Props) {
  const importInputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<AutoBackupSettings>(() => ({
    ...defaultAutoBackupSettings(),
    ...autoBackup
  }));
  const [savingAutoBackup, setSavingAutoBackup] = useState(false);

  const saveAutoBackup = async () => {
    if (!onSaveAutoBackup) return;
    setSavingAutoBackup(true);
    try {
      await onSaveAutoBackup({ ...draft, keep: Math.max(draft.keep, 1) });
    } finally {
      setSavingAutoBackup(false);
    }
  };

  return (
    <Modal
      open={open}
      title="关于 JLU GPA"
      footer={null}
      width={560}
      className="about-dialog"
      onCancel={onClose}
    >
      <Alert
        type="info"
        showIcon
        className="about-privacy-alert"
        message="所有数据均在本机处理与保存，不会上传服务器。"
      />
      <Typography.Paragraph>
        面向吉林大学本科生的本地优先绩点核算桌面应用，可计算保研 GPA、加权平均分和算术平均分。
      </Typography.Paragraph>
      <Descriptions column={1} size="small" bordered>
        <Descriptions.Item label="版本">正式版 v1.0.1</Descriptions.Item>
        <Descriptions.Item label="项目地址">
          <Typography.Link
            href="https://github.com/Coldymemos/JLU-GPA-Calculator-for-Windows-Desktop"
            target="_blank"
            rel="noopener noreferrer"
          >
            Desktop GitHub 仓库
          </Typography.Link>
        </Descriptions.Item>
        <Descriptions.Item label="作者">Coldymemos</Descriptions.Item>
        <Descriptions.Item label="共同作者">DailyPotato</Descriptions.Item>
        <Descriptions.Item label="开源与使用">
          本项目源码按 PolyForm Noncommercial License 1.0.0
          提供，允许非商业使用、研究、修改和分享；商业用途需事先取得作者授权。
        </Descriptions.Item>
      </Descriptions>
      <Divider plain className="about-reset-divider">
        数据管理
      </Divider>
      <Space orientation="vertical" className="full-width">
        {onBackupDatabase && (
          <Button block onClick={onBackupDatabase}>
            备份 SQLite 数据库
          </Button>
        )}
        {onRestoreDatabase && (
          <Button block onClick={onRestoreDatabase}>
            恢复 SQLite 数据库
          </Button>
        )}
        <Button block icon={<DownloadOutlined />} onClick={onExportData}>
          导出当前档案迁移文件
        </Button>
        <Button block icon={<UploadOutlined />} onClick={() => importInputRef.current?.click()}>
          导入并替换当前档案
        </Button>
        <input
          ref={importInputRef}
          hidden
          type="file"
          accept="application/json,.json"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) onImportData(file);
          }}
        />
      </Space>
      {onSaveAutoBackup && (
        <>
          <Divider plain className="about-reset-divider">
            自动备份
          </Divider>
          <Space orientation="vertical" className="full-width">
            <Space>
              <Switch
                checked={draft.enabled}
                onChange={(enabled) => setDraft({ ...draft, enabled })}
              />
              <Typography.Text>启用定时备份（应用运行时检查）</Typography.Text>
            </Space>
            <Radio.Group
              value={draft.frequency}
              disabled={!draft.enabled}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  frequency: event.target.value as AutoBackupSettings['frequency']
                })
              }
              options={[
                { label: '每日', value: 'daily' },
                { label: '每周', value: 'weekly' }
              ]}
            />
            <Space>
              <Typography.Text>保留备份份数</Typography.Text>
              <InputNumber
                min={1}
                max={30}
                disabled={!draft.enabled}
                value={draft.keep}
                onChange={(keep) => setDraft({ ...draft, keep: keep ?? 7 })}
              />
            </Space>
            <Space className="full-width">
              <Button
                icon={<FolderOpenOutlined />}
                disabled={!draft.enabled}
                onClick={() => {
                  if (!onPickBackupDirectory) return;
                  void onPickBackupDirectory().then((directory) => {
                    if (directory) setDraft({ ...draft, directory });
                  });
                }}
              >
                选择备份目录
              </Button>
              <Typography.Text type="secondary" ellipsis>
                {draft.directory || '未选择'}
              </Typography.Text>
            </Space>
            <Button
              type="primary"
              block
              loading={savingAutoBackup}
              onClick={() => void saveAutoBackup()}
            >
              保存自动备份设置
            </Button>
          </Space>
        </>
      )}
      <Divider />
      <Button danger block icon={<DeleteOutlined />} onClick={onResetAll}>
        清空当前档案数据
      </Button>
      <Typography.Paragraph type="secondary" className="about-disclaimer">
        普瑞赛斯正在看着你哦
      </Typography.Paragraph>
    </Modal>
  );
}
