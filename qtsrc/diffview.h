#ifndef DIFFVIEW_H
#define DIFFVIEW_H

#include <QWidget>
#include <QList>
#include <QPair>
#include <QColor>

class DiffView : public QWidget
{
    Q_OBJECT
public:
    enum ChangeType {
        Unchanged,
        Added,
        Removed
    };

    // Represents a single line in the diff, along with its change type.
    struct DiffLine {
        QString text;
        ChangeType changeType;
    };


    explicit DiffView(QWidget *parent = nullptr);

    void setDiffData(const QList<DiffLine>& diffData);

protected:
    void paintEvent(QPaintEvent *event) override;

private:
    QList<DiffLine> m_diffData; // Stores the diff data

};

#endif // DIFFVIEW_H
