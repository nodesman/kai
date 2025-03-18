// diffview.h
#ifndef DIFFVIEW_H
#define DIFFVIEW_H

#include <QWidget>
#include <QList>
#include <QPair>
#include <QColor>
#include <QAbstractListModel> // Include for the model


// Forward declarations to avoid circular dependencies
class DiffModel;

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
    ~DiffView();

    void setDiffData(const QList<DiffLine>& diffData);
    void setModel(DiffModel *model);


protected:
    void paintEvent(QPaintEvent *event) override;
    QSize sizeHint() const override;
    QSize minimumSizeHint() const override;


private:
    QList<DiffLine> m_diffData; // Stores the diff data
    DiffModel *m_model;       // Pointer to the model
    QList<DiffView::DiffLine> parseDiffContent(const QString& content);


};

#endif // DIFFVIEW_H