import { DeleteOutlined, DownloadOutlined, UploadOutlined } from '@ant-design/icons';
import { Alert, Button, Descriptions, Divider, Modal, Space, Typography } from 'antd';
import { useRef } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  onResetAll: () => void;
  onExportData: () => void;
  onImportData: (file: File) => void;
  onBackupDatabase?: () => void;
  onRestoreDatabase?: () => void;
}

export function AboutDialog({
  open,
  onClose,
  onResetAll,
  onExportData,
  onImportData,
  onBackupDatabase,
  onRestoreDatabase
}: Props) {
  const importInputRef = useRef<HTMLInputElement>(null);

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
          本项目基于 GPL v3.0 协议开源，仅供学习与个人使用，请勿用于商业用途。
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
