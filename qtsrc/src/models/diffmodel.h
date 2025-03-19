#ifndef DIFFMODEL_H
#define DIFFMODEL_H

#include <QAbstractListModel>
#include <QStringList>
#include <QList>
#include <QVariant>

class DiffModel : public QAbstractListModel
{
    Q_OBJECT
public:
    explicit DiffModel(QObject *parent = nullptr);

    enum Roles {
        FilePathRole = Qt::UserRole + 1,
        FileContentRole
    };

    int rowCount(const QModelIndex &parent = QModelIndex()) const override;
    QVariant data(const QModelIndex &index, int role = Qt::DisplayRole) const override;
    QHash<int, QByteArray> roleNames() const override;
    void setFiles(const QStringList& filePaths, const QList<QString>& fileContents);
    QString getFileContent(int index) const; // Already existing function
    QString getFilePath(int index) const; // New function

    public slots:
        void clearDiffModel();

private:
    QStringList m_filePaths;
    QList<QString> m_fileContents;
};

#endif // DIFFMODEL_H