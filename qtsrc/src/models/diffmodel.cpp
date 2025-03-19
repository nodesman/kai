#include "diffmodel.h"
#include <QDebug>

DiffModel::DiffModel(QObject *parent)
    : QAbstractListModel(parent)
{
}

int DiffModel::rowCount(const QModelIndex &parent) const
{
    if (parent.isValid())
        return 0;

    return m_filePaths.count();
}

QVariant DiffModel::data(const QModelIndex &index, int role) const
{
    if (!index.isValid() || index.row() >= m_filePaths.count())
        return QVariant();

    switch (role) {
        case FilePathRole:
            return m_filePaths.at(index.row());
        case FileContentRole:
            return m_fileContents.at(index.row());
        default:
            return QVariant();
    }
}

QHash<int, QByteArray> DiffModel::roleNames() const
{
    QHash<int, QByteArray> roles;
    roles[FilePathRole] = "filePath";
    roles[FileContentRole] = "fileContent";
    return roles;
}

void DiffModel::setFiles(const QStringList& filePaths, const QList<QString>& fileContents)
{
    beginResetModel();
    m_filePaths = filePaths;
    m_fileContents = fileContents;
    endResetModel();
    qDebug() << "DiffModel updated with" << m_filePaths.size() << "files.";
}

void DiffModel::clearDiffModel()
{
    beginResetModel();
    m_filePaths.clear();
    m_fileContents.clear();
    endResetModel();
    qDebug() << "DiffModel cleared.";
}

QString DiffModel::getFileContent(int index) const
{
    if (index >= 0 && index < m_fileContents.count()) {
        return m_fileContents.at(index);
    }
    return QString(); // Return empty string if index is invalid
}

QString DiffModel::getFilePath(int index) const {
    if (index >= 0 && index < m_filePaths.count()) {
        return m_filePaths.at(index);
    }
    return QString(); // Return empty string for invalid index
}